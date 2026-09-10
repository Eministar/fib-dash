/**
 * Erlaubte Dateitypen der Upload-API.
 *
 * Bewusst ohne Node-Imports: diese Datei wird auch von Client-Komponenten
 * genutzt. Alles, was Dateisystem oder Datenbank braucht, liegt in
 * `file-uploads.ts`.
 */

export const FILE_UPLOAD_TYPES: Record<string, string> = {
  'text/html': '.html',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

/**
 * Textformate haben keine Magic Bytes. Statt einer Signatur wird bei ihnen
 * geprüft, ob der Inhalt gültiges UTF-8 ohne Nullbytes ist.
 */
export const TEXT_UPLOAD_TYPES = ['text/html', 'text/plain', 'text/markdown', 'text/csv', 'application/json']

export const DEFAULT_FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

/** Endungen, die der Browser statt eines MIME-Typs schickt (`application/octet-stream`). */
const EXTENSION_FALLBACK: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/**
 * Normalisiert den vom Client gemeldeten MIME-Typ: Parameter wie
 * `; charset=utf-8` fallen weg, und wenn der Client nichts Brauchbares
 * schickt, entscheidet die Dateiendung.
 */
export function normalizeUploadMime(mimeType: string | null | undefined, originalName: string): string | null {
  const declared = (mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (declared && declared in FILE_UPLOAD_TYPES) return declared
  const extension = originalName.toLowerCase().split('.').pop() ?? ''
  return EXTENSION_FALLBACK[extension] ?? null
}

export function isTextUpload(mimeType: string) {
  return TEXT_UPLOAD_TYPES.includes(mimeType)
}

/** Wie die Datei im Betrachter dargestellt wird. */
export type UploadPreview = 'html' | 'image' | 'pdf' | 'video' | 'text' | 'download'

export function previewKind(mimeType: string): UploadPreview {
  if (mimeType === 'text/html') return 'html'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('video/')) return 'video'
  if (isTextUpload(mimeType)) return 'text'
  return 'download'
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
