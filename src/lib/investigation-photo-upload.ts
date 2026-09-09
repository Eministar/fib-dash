import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { MAX_IMAGE_BYTES, detectPhotoType, photoPath } from './investigation-photos'

/** Dasselbe Limit wie beim Discord-Import – ein Bild soll nicht davon
 *  abhängen, auf welchem Weg es in den Katalog kommt. */
export const MAX_PHOTO_UPLOAD_BYTES = MAX_IMAGE_BYTES

export class PhotoUploadError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const TOO_LARGE = 'Bild zu groß (max. 20 MB)'

/**
 * Nimmt einen rohen Upload-Stream entgegen und legt ihn als Katalogbild ab.
 * Der Typ wird ausschließlich aus den Magic Bytes bestimmt: ein vom Client
 * geschickter `Content-Type` darf nicht entscheiden, was auf der Platte landet.
 */
export async function savePhotoUpload(body: ReadableStream<Uint8Array>, expectedSize?: number) {
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)) {
    throw new PhotoUploadError('Ungültige Dateigröße')
  }
  if (expectedSize !== undefined && expectedSize > MAX_PHOTO_UPLOAD_BYTES) {
    throw new PhotoUploadError(TOO_LARGE, 413)
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let sizeBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sizeBytes += value.length
      // Abbruch, sobald das Limit reißt – nicht erst, wenn alles im Speicher liegt.
      if (sizeBytes > MAX_PHOTO_UPLOAD_BYTES) {
        await reader.cancel()
        throw new PhotoUploadError(TOO_LARGE, 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (!sizeBytes) throw new PhotoUploadError('Datei fehlt')
  if (expectedSize !== undefined && sizeBytes !== expectedSize) {
    throw new PhotoUploadError('Upload unvollständig. Bitte erneut hochladen.')
  }

  const bytes = Buffer.concat(chunks)
  const type = detectPhotoType(bytes)
  if (!type) throw new PhotoUploadError('Unterstützt werden JPG, PNG, WebP und GIF.')

  const filename = `${randomUUID()}.${type.extension}`
  const target = photoPath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes, { flag: 'wx' })
  return { filename, mimeType: type.mimeType, sizeBytes }
}

/** Entfernt eine Datei, deren Datenbankzeile nicht zustande kam. */
export async function discardPhotoUpload(filename: string) {
  await unlink(photoPath(filename)).catch(() => {})
}

export function photoUploadRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof PhotoUploadError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error('Beschriftung fehlt oder ist zu lang')
  console.error('[PhotoUpload]', cause)
  return error('Bild konnte nicht gespeichert werden', 500)
}
