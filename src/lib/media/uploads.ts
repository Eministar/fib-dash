import { unlink } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

export interface StoredUploadInfo {
  filename: string
  url: string
  size: number
  extension: string
  modifiedAt: string
}

export function uploadMaxBytes() {
  const raw = Number.parseInt(process.env.UPLOAD_MAX_BYTES || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_MAX_BYTES
}

export function uploadDir() {
  const configured = process.env.UPLOAD_DIR?.trim()
  if (configured) {
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured)
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), 'uploads')
}

export function isStoredUploadFilename(filename: string) {
  const clean = path.basename(filename)
  if (clean !== filename) return false
  return /^[a-f0-9-]{36}(?:\.[a-z0-9][a-z0-9_-]{0,31})?$/i.test(filename)
}

export function resolveUploadPath(filename: string) {
  if (!isStoredUploadFilename(filename)) throw new Error('Dateiname ist ungültig')

  const base = uploadDir()
  // The path is intentionally resolved at runtime from a validated filename;
  // tell Turbopack not to treat this dynamic join as a build-time dependency.
  const target = path.normalize(path.join(/*turbopackIgnore: true*/ base, filename))
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Dateiname ist ungültig')

  return target
}

export async function deleteUploadedFile(filename: string) {
  if (!isStoredUploadFilename(filename)) throw new Error('Dateiname ist ungültig')

  await unlink(resolveUploadPath(filename))
}
