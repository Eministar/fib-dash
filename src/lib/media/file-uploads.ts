import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { z } from 'zod'
import { uploadDir } from './uploads'
import { matchesFileSignature } from './upload-signatures'
import { FILE_UPLOAD_TYPES, isTextUpload, normalizeUploadMime, previewKind } from './file-upload-types'
import { parseRangeHeader } from './clips'

/**
 * Ablage und Prüfung der Dateien hinter `/api/files`.
 *
 * Eigenständiges Modul: es teilt mit den Ermittlungen nur `uploadDir()` als
 * Wurzelverzeichnis und die Signaturprüfung — sonst nichts.
 */

export class FileUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'FileUploadError'
  }
}

export function fileUploadDir() {
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'files')
}

/** Nur selbst vergebene Namen (`<uuid>.<ext>`) — verhindert Pfadausbruch. */
export function fileUploadPath(filename: string) {
  const extensions = Object.values(FILE_UPLOAD_TYPES)
    .map((ext) => ext.slice(1))
    .join('|')
  if (!new RegExp(`^[a-f0-9-]{36}\\.(${extensions})$`).test(filename)) {
    throw new FileUploadError('Ungültiger Dateiname', 400)
  }
  return path.join(/*turbopackIgnore: true*/ fileUploadDir(), filename)
}

/**
 * Prüft, ob der Inhalt zum gemeldeten Typ passt. Binärformate über ihre
 * Magic Bytes, Textformate über die UTF-8-Dekodierung: HTML-Transkripte
 * haben keine Signatur, aber eine als HTML deklarierte .exe scheitert
 * zuverlässig an Nullbytes und ungültigen Sequenzen.
 */
export function contentMatchesType(mimeType: string, content: Buffer): boolean {
  if (!isTextUpload(mimeType)) return matchesFileSignature(mimeType, content)
  if (content.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return false
  }
  if (mimeType === 'application/json') {
    try {
      JSON.parse(content.toString('utf8'))
    } catch {
      throw new FileUploadError('Die Datei ist als JSON deklariert, lässt sich aber nicht parsen', 422)
    }
  }
  return true
}

/** Metadaten, die API und Dashboard gleichermaßen setzen dürfen. */
export const fileUploadMetaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10000).optional(),
  category: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(25).optional(),
  externalRef: z.string().trim().max(200).optional(),
  externalUrl: z.string().trim().url().max(2000).optional(),
  externalUser: z.string().trim().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type FileUploadMeta = z.infer<typeof fileUploadMetaSchema>

/**
 * Liest die Metadaten aus einem multipart-Body. Alles kommt als String an,
 * `tags` zusätzlich kommasepariert oder als wiederholtes Feld, `metadata`
 * als JSON-Text.
 */
export function metaFromFormData(form: FormData): FileUploadMeta {
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  const tagValues = form
    .getAll('tags')
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  const rawMetadata = text('metadata')
  let metadata: Record<string, unknown> | undefined
  if (rawMetadata) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawMetadata)
    } catch {
      throw new FileUploadError('Das Feld "metadata" ist kein gültiges JSON', 400)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FileUploadError('Das Feld "metadata" muss ein JSON-Objekt sein', 400)
    }
    metadata = parsed as Record<string, unknown>
  }

  const parsed = fileUploadMetaSchema.safeParse({
    title: text('title'),
    description: text('description'),
    category: text('category'),
    tags: tagValues.length ? [...new Set(tagValues)] : undefined,
    externalRef: text('externalRef'),
    externalUrl: text('externalUrl'),
    externalUser: text('externalUser'),
    metadata,
  })
  if (!parsed.success) {
    throw new FileUploadError(
      `Ungültige Felder: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'} — ${issue.message}`).join('; ')}`,
      400,
    )
  }
  return parsed.data
}

export interface StoredFile {
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

/**
 * Prüft eine hochgeladene Datei und legt sie unter einem neu vergebenen
 * Namen ab. Der Aufrufer entfernt sie wieder, falls der Datenbankschreib
 * danach scheitert.
 */
export async function storeUploadedFile(file: File, maxBytes: number): Promise<StoredFile> {
  const originalName = file.name?.trim() || 'upload'
  if (file.size === 0) throw new FileUploadError('Die Datei ist leer', 400)
  if (file.size > maxBytes) {
    throw new FileUploadError(
      `Die Datei ist ${Math.round(file.size / 1024 / 1024)} MB groß, erlaubt sind ${Math.round(maxBytes / 1024 / 1024)} MB`,
      413,
    )
  }

  const mimeType = normalizeUploadMime(file.type, originalName)
  if (!mimeType) {
    throw new FileUploadError(
      `Dateityp nicht erlaubt. Erlaubt sind: ${Object.values(FILE_UPLOAD_TYPES).join(', ')}`,
      415,
    )
  }

  const content = Buffer.from(await file.arrayBuffer())
  if (content.byteLength > maxBytes) throw new FileUploadError('Die Datei überschreitet das Größenlimit', 413)
  if (!contentMatchesType(mimeType, content)) {
    throw new FileUploadError(`Der Inhalt der Datei passt nicht zum Typ ${mimeType}`, 422)
  }

  const filename = `${randomUUID()}${FILE_UPLOAD_TYPES[mimeType]}`
  const target = fileUploadPath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)

  return {
    filename,
    mimeType,
    sizeBytes: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

export async function deleteStoredFile(filename: string) {
  await unlink(fileUploadPath(filename)).catch(() => undefined)
}

/**
 * Content-Security-Policy für die Auslieferung.
 *
 * HTML-Transkripte werden byte-genau ausgeliefert, aber ohne `allow-scripts`
 * und ohne `allow-same-origin`: das Dokument landet in einem eigenen,
 * rechtelosen Origin und kommt damit weder an Cookies noch an das Dashboard.
 * Bilder und Schriften dürfen extern nachladen, damit Transkripte mit
 * Avataren lesbar bleiben.
 */
const HTML_CSP = [
  'sandbox',
  "default-src 'none'",
  'img-src https: data: blob:',
  "style-src 'unsafe-inline' https:",
  'font-src https: data:',
  "media-src 'none'",
  "script-src 'none'",
  "frame-src 'none'",
].join('; ')

/**
 * Alles außer HTML bekommt nur `default-src 'none'`, aber KEIN `sandbox`:
 * die Sandbox würde den eingebauten PDF-Viewer und die Videowiedergabe
 * lahmlegen, ohne etwas zu schützen — Bilder, PDFs und Videos führen kein
 * fremdes Skript im Dashboard-Origin aus, dafür sorgt `nosniff`.
 */
const BINARY_CSP = "default-src 'none'"

/** Inline anzeigen ist nur da sinnvoll, wo der Browser es sicher kann. */
function contentDisposition(mimeType: string, originalName: string) {
  const kind = previewKind(mimeType)
  const inline = kind === 'html' || kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'text'
  const safeName = originalName.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'download'
  return `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`
}

/**
 * Liefert die Datei aus — mit Range-Unterstützung, damit sich Videos
 * spulen lassen.
 */
export async function fileUploadResponse(
  upload: { filename: string; mimeType: string; originalName: string },
  rangeHeader: string | null,
) {
  const file = fileUploadPath(upload.filename)
  const { size } = await stat(file)
  const range = parseRangeHeader(rangeHeader, size)

  const headers: Record<string, string> = {
    'Content-Type': upload.mimeType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(upload.mimeType, upload.originalName),
    'Content-Security-Policy': upload.mimeType === 'text/html' ? HTML_CSP : BINARY_CSP,
    'Referrer-Policy': 'no-referrer',
  }

  if (rangeHeader && !range) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  }
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
  headers['Content-Length'] = String(range ? range.end - range.start + 1 : size)

  return new Response(Readable.toWeb(createReadStream(file, range ?? undefined)) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  })
}
