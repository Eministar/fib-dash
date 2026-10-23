import { unlink } from 'node:fs/promises'
import { z } from 'zod'
import { error, forbidden, unauthorized } from '../api-response'
import { photoPath } from './investigation-photos'

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
