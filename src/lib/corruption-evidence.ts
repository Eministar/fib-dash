import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { uploadDir } from './uploads'
import { parseRangeHeader } from './clips'
import { CorruptionError } from './corruption-server'
import { matchesFileSignature } from './upload-signatures'

export const evidenceTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
export function evidencePath(filename: string) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|gif|webp|pdf|mp4|webm|mov)$/.test(filename)) throw new CorruptionError('Ungültiger Dateiname')
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'corruption-evidence', filename)
}
export { matchesFileSignature as matchesEvidenceType } from './upload-signatures'
export async function saveEvidence(body: ReadableStream<Uint8Array>, mime: string, expectedSize?: number) {
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)) throw new CorruptionError('Ungültige Dateigröße')
  if (expectedSize !== undefined && expectedSize > 500 * 1024 * 1024) throw new CorruptionError('Datei zu groß (max. 500 MB)', 413)
  const extension = evidenceTypes[mime]
  if (!extension) throw new CorruptionError('Unterstützt: JPG, PNG, GIF, WebP, PDF, MP4, WebM und MOV.')
  const filename = `${randomUUID()}.${extension}`
  const target = evidencePath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  let sizeBytes = 0
  let prefix = Buffer.alloc(0)
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    sizeBytes += chunk.length
    if (sizeBytes > 500 * 1024 * 1024) return callback(new CorruptionError('Datei zu groß (max. 500 MB)', 413))
    if (prefix.length < 32) prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)])
    callback(null, chunk)
  } })
  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), limiter, createWriteStream(target, { flags: 'wx' }))
    if (expectedSize !== undefined && sizeBytes !== expectedSize) throw new CorruptionError('Upload unvollständig. Bitte erneut hochladen.')
    if (!matchesFileSignature(mime, prefix)) throw new CorruptionError('Dateiinhalt passt nicht zum angegebenen Format')
    return { filename, sizeBytes, mimeType: mime }
  } catch (cause) { await unlink(target).catch(() => {}); throw cause }
}
export async function evidenceResponse(filename: string, mime: string, rangeHeader: string | null) {
  const file = evidencePath(filename)
  const { size } = await stat(file)
  const range = parseRangeHeader(rangeHeader, size)
  const headers: Record<string, string> = { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes', 'Content-Disposition': `${mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${filename}"` }
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
  headers['Content-Length'] = String(range ? range.end - range.start + 1 : size)
  return new Response(Readable.toWeb(createReadStream(file, range ?? undefined)) as ReadableStream, { status: range ? 206 : 200, headers })
}
