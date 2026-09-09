import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ALLOWED_CLIP_TYPES, clipMaxBytes } from './clips'
import { evidenceTypes } from './corruption-evidence'
import { MAX_IMAGE_BYTES } from './investigation-photos'
import { uploadDir, uploadMaxBytes } from './uploads'

export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type UploadKind = 'CLIP' | 'EVIDENCE' | 'PHOTO' | 'RESOURCE'

export class UploadSessionError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UploadSessionError'
    this.status = status
  }
}

/** MIME-Typ auf Dateiendung, jeweils mit führendem Punkt. */
function withDots(types: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(types).map(([mime, ext]) => [mime, ext.startsWith('.') ? ext : `.${ext}`]),
  )
}

/**
 * Was je Upload-Art erlaubt ist. Die Grenzen kommen aus den bestehenden
 * Modulen, damit es nicht zwei Wahrheiten über dieselbe Zahl gibt.
 */
export const uploadKindRules: Record<UploadKind, { maxBytes: () => number; types: Record<string, string> }> = {
  CLIP: { maxBytes: clipMaxBytes, types: ALLOWED_CLIP_TYPES },
  EVIDENCE: { maxBytes: () => 500 * 1024 * 1024, types: withDots(evidenceTypes) },
  PHOTO: {
    maxBytes: () => MAX_IMAGE_BYTES,
    types: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' },
  },
  RESOURCE: {
    maxBytes: uploadMaxBytes,
    types: {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    },
  },
}

export function uploadChunkBytes() {
  const raw = Number.parseInt(process.env.UPLOAD_CHUNK_BYTES || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_CHUNK_BYTES
}

export function chunkCountFor(totalBytes: number, chunkSize: number) {
  return Math.max(1, Math.ceil(totalBytes / chunkSize))
}

/** cuid, wie Prisma sie erzeugt — bewusst eng, weil daraus ein Pfad wird. */
function assertSessionId(sessionId: string) {
  if (!/^[a-z0-9]{18,32}$/i.test(sessionId)) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
}

export function incomingDir(sessionId: string) {
  assertSessionId(sessionId)
  const base = path.join(/*turbopackIgnore: true*/ uploadDir(), 'incoming')
  const target = path.normalize(path.join(/*turbopackIgnore: true*/ base, sessionId))
  if (!target.startsWith(`${base}${path.sep}`)) throw new UploadSessionError('Upload-Sitzung nicht gefunden', 404)
  return target
}

export function chunkPath(sessionId: string, index: number, extension = '.part') {
  if (!Number.isSafeInteger(index) || index < 0) throw new UploadSessionError('Ungültiger Chunk-Index')
  return path.join(/*turbopackIgnore: true*/ incomingDir(sessionId), `${index}${extension}`)
}

/**
 * Der Fortschritt kommt aus dem Dateisystem: ein `.part` entsteht erst durch
 * das abschließende Umbenennen, existiert also nur für vollständig geprüfte
 * Chunks. Halbfertige `.tmp` zählen nicht mit.
 */
export async function receivedChunkIndexes(sessionId: string): Promise<number[]> {
  let entries: string[]
  try {
    entries = await readdir(incomingDir(sessionId))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }

  return entries
    .filter((name) => /^\d+\.part$/.test(name))
    .map((name) => Number.parseInt(name.slice(0, -'.part'.length), 10))
    .filter((index) => Number.isSafeInteger(index) && index >= 0)
    .sort((a, b) => a - b)
}

/**
 * Schreibt einen Chunk nach `<index>.<uuid>.tmp` und benennt ihn erst nach
 * bestandener Prüfung auf `<index>.part` um. Dadurch existiert ein `.part`
 * ausschließlich für vollständige, verifizierte Daten — und der Fortschritt
 * lässt sich allein aus dem Ordner ablesen.
 *
 * Der zufällige Zwischenname verhindert, dass zwei gleichzeitige Zustellungen
 * desselben Index einander die Datei unter den Füßen wegziehen.
 */
export async function storeChunk(
  sessionId: string,
  index: number,
  body: ReadableStream<Uint8Array>,
  expectedSha256: string,
  expectedBytes: number,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new UploadSessionError('Ungültige Prüfsumme')
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new UploadSessionError('Ungültige Chunk-Größe')
  }

  const target = chunkPath(sessionId, index)
  const temporary = chunkPath(sessionId, index, `.${randomUUID()}.tmp`)
  await mkdir(incomingDir(sessionId), { recursive: true })

  let sizeBytes = 0
  const hash = createHash('sha256')
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length
      if (sizeBytes > expectedBytes) {
        callback(new UploadSessionError('Chunk ist größer als angekündigt'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
    await pipeline(source, meter, createWriteStream(temporary))

    if (sizeBytes !== expectedBytes) throw new UploadSessionError('Chunk ist unvollständig')

    const actual = Buffer.from(hash.digest('hex'), 'utf8')
    const expected = Buffer.from(expectedSha256.toLowerCase(), 'utf8')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UploadSessionError('Prüfsumme des Chunks stimmt nicht')
    }

    await rename(temporary, target)
  } catch (cause) {
    await unlink(temporary).catch(() => {})
    throw cause
  }
}
