import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { uploadDir } from '@/lib/uploads'

export const DEFAULT_CLIP_MAX_BYTES = 500 * 1024 * 1024

/// Erlaubte Videoformate mit der Endung, unter der die Datei abgelegt wird.
export const ALLOWED_CLIP_TYPES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
}

export class ClipTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Clip ist zu groß (max. ${Math.floor(maxBytes / (1024 * 1024))} MB)`)
    this.name = 'ClipTooLargeError'
  }
}

export function clipMaxBytes() {
  const raw = Number.parseInt(process.env.CLIP_MAX_BYTES || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLIP_MAX_BYTES
}

/**
 * Ablageverzeichnis der Clips. Standardmäßig ein Unterordner der bestehenden
 * Upload-Ablage, damit Deployments nur ein Volume persistieren müssen.
 */
export function clipDir() {
  const configured = process.env.CLIP_DIR?.trim()
  if (configured) {
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured)
  }
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'clips')
}

export function isStoredClipFilename(filename: string) {
  const clean = path.basename(filename)
  if (clean !== filename) return false
  return /^[a-f0-9-]{36}\.(mp4|webm|mov|mkv)$/i.test(filename)
}

export function resolveClipPath(filename: string) {
  if (!isStoredClipFilename(filename)) throw new Error('Dateiname ist ungültig')

  const base = clipDir()
  // Der Pfad wird bewusst zur Laufzeit aus einem validierten Dateinamen
  // zusammengesetzt; Turbopack darf das nicht als Build-Abhängigkeit sehen.
  const target = path.normalize(path.join(/*turbopackIgnore: true*/ base, filename))
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Dateiname ist ungültig')

  return target
}

export function clipExtensionFor(mimeType: string) {
  return ALLOWED_CLIP_TYPES[mimeType.split(';')[0]!.trim().toLowerCase()] ?? null
}

/**
 * Schreibt den Request-Body als Stream auf Platte. Die Datei landet nie
 * vollständig im Speicher; bei Limit-Überschreitung oder Abbruch wird die
 * angefangene Datei wieder entfernt.
 */
export async function saveClipStream(
  body: ReadableStream<Uint8Array>,
  mimeType: string,
): Promise<{ filename: string; sizeBytes: number }> {
  const extension = clipExtensionFor(mimeType)
  if (!extension) throw new Error('Nicht unterstütztes Videoformat')

  const maxBytes = clipMaxBytes()
  const filename = `${randomUUID()}${extension}`
  const target = resolveClipPath(filename)

  await mkdir(clipDir(), { recursive: true })

  let sizeBytes = 0
  const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length
      if (sizeBytes > maxBytes) {
        callback(new ClipTooLargeError(maxBytes))
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(source, limiter, createWriteStream(target))
  } catch (cause) {
    await unlink(target).catch(() => {})
    throw cause
  }

  if (sizeBytes === 0) {
    await unlink(target).catch(() => {})
    throw new Error('Clip ist leer')
  }

  return { filename, sizeBytes }
}

export async function deleteClipFile(filename: string) {
  if (!isStoredClipFilename(filename)) return
  await unlink(resolveClipPath(filename)).catch(() => {})
}

interface ParsedRange {
  start: number
  end: number
}

/**
 * Wertet einen `Range`-Header aus. Unterstützt wird bewusst nur ein einzelner
 * Bereich – mehr braucht kein Browser-Videoplayer.
 */
export function parseRangeHeader(header: string | null, size: number): ParsedRange | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  let start: number
  let end: number

  if (!rawStart) {
    // Suffix-Range: die letzten N Bytes.
    const suffix = Number.parseInt(rawEnd!, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number.parseInt(rawStart, 10)
    end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

/**
 * Liefert die Videodatei aus – als Vollantwort oder als 206-Teilantwort, damit
 * im Player gespult werden kann.
 */
export async function clipFileResponse(
  filename: string,
  mimeType: string,
  rangeHeader: string | null,
): Promise<Response> {
  const target = resolveClipPath(filename)
  const info = await stat(target)
  const size = info.size

  const commonHeaders: Record<string, string> = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    // Clips sind unveränderlich; der Zugriffsschutz sitzt in der Route, deshalb
    // ausdrücklich nur ein privater Cache.
    'Cache-Control': 'private, max-age=3600',
  }

  const range = parseRangeHeader(rangeHeader, size)

  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
    })
  }

  if (!range) {
    const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(size) },
    })
  }

  const stream = Readable.toWeb(
    createReadStream(target, { start: range.start, end: range.end }),
  ) as unknown as ReadableStream

  return new Response(stream, {
    status: 206,
    headers: {
      ...commonHeaders,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  })
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
