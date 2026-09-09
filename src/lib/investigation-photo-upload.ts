import { unlink } from 'node:fs/promises'
import { z } from 'zod'
import { error, forbidden, unauthorized } from './api-response'
import { MAX_IMAGE_BYTES, photoPath } from './investigation-photos'

/** Dasselbe Limit wie beim Discord-Import – ein Bild soll nicht davon
 *  abhängen, auf welchem Weg es in den Katalog kommt. */
export const MAX_PHOTO_UPLOAD_BYTES = MAX_IMAGE_BYTES

export class PhotoUploadError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
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
