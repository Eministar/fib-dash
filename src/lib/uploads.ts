import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

export interface UploadedFileInfo {
  id: string
  filename: string
  originalName: string
  size: number
  mimeType: string
  url: string
}

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

function sanitizeExt(name: string) {
  const ext = path.extname(name).toLowerCase()
  if (!ext || ext.length > 32) return ''
  if (!/^\.[a-z0-9][a-z0-9_-]*$/i.test(ext)) return ''
  return ext
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

export function validateUploadFile(file: File) {
  if (file.size === 0) return 'Datei ist leer'
  if (file.size > uploadMaxBytes()) return `Datei zu groß (max. ${uploadMaxBytes()} Bytes)`

  return null
}

export async function saveUploadedFile(file: File): Promise<UploadedFileInfo> {
  const validationError = validateUploadFile(file)
  if (validationError) throw new Error(validationError)

  const ext = sanitizeExt(file.name)
  const id = randomUUID()
  const filename = `${id}${ext}`
  const dir = uploadDir()
  await mkdir(dir, { recursive: true })

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(resolveUploadPath(filename), buffer)

  return {
    id,
    filename,
    originalName: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    url: `/uploads/${filename}`,
  }
}

export async function listUploadedFiles(): Promise<StoredUploadInfo[]> {
  const dir = uploadDir()
  await mkdir(dir, { recursive: true })

  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isStoredUploadFilename(entry.name))
      .map(async (entry) => {
        const fileStat = await stat(resolveUploadPath(entry.name))
        return {
          filename: entry.name,
          url: `/uploads/${entry.name}`,
          size: fileStat.size,
          extension: sanitizeExt(entry.name).replace('.', '').toUpperCase(),
          modifiedAt: fileStat.mtime.toISOString(),
        }
      }),
  )

  return files.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
}

export async function deleteUploadedFile(filename: string) {
  if (!isStoredUploadFilename(filename)) throw new Error('Dateiname ist ungültig')

  await unlink(resolveUploadPath(filename))
}
