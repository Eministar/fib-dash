import { z } from 'zod'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  PhotoUploadError,
  discardPhotoUpload,
  photoUploadRouteError,
  savePhotoUpload,
} from '@/lib/investigation-photo-upload'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'

export const dynamic = 'force-dynamic'
export const OPTIONS = uploadOptions

export async function POST(req: Request) {
  return uploadCors(req, await uploadPhoto(req))
}

/**
 * Rohbody statt `FormData`: Nexts Body-Klonen zöge bei großen Bildern den
 * Speicher doppelt. Dasselbe Muster nutzt der Asservate-Upload.
 */
async function uploadPhoto(req: Request) {
  let stored: string | undefined
  try {
    const user = await requirePermission('investigations:manage')
    if (!req.body) throw new PhotoUploadError('Datei fehlt')

    const title = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(decodeURIComponent(req.headers.get('x-photo-title') ?? ''))
    const expected = req.headers.get('x-upload-size') ?? req.headers.get('content-length')
    const file = await savePhotoUpload(req.body, expected === null ? undefined : Number(expected))
    stored = file.filename

    const photo = await prisma.$transaction(async (tx) => {
      const created = await tx.investigationPhoto.create({
        data: { ...file, title, uploadedById: user.id },
      })
      await createAuditLog(
        { action: 'PHOTO_UPLOADED', userId: user.id, details: `Bildkatalog: „${title}“` },
        tx,
      )
      return created
    })
    stored = undefined

    return success(
      { id: photo.id, title: photo.title, url: `/api/investigations/photos/${photo.id}/image` },
      201,
    )
  } catch (cause) {
    // Erst löschen, wenn feststeht, dass keine Zeile auf die Datei zeigt.
    if (stored) {
      try {
        if (!(await prisma.investigationPhoto.findUnique({ where: { filename: stored } }))) {
          await discardPhotoUpload(stored)
        }
      } catch {
        /* Möglicherweise referenzierte Bytes bleiben lieber liegen. */
      }
    }
    return photoUploadRouteError(cause)
  }
}
