import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { uploadDir } from './uploads'
import { parseRangeHeader } from './clips'
import { CorruptionError } from './corruption-server'

export const evidenceTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
export function evidencePath(filename: string) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|gif|webp|pdf|mp4|webm|mov)$/.test(filename)) throw new CorruptionError('Ungültiger Dateiname')
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'corruption-evidence', filename)
}
export { matchesFileSignature as matchesEvidenceType } from './upload-signatures'
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
