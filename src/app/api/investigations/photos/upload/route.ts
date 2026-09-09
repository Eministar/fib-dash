import { z } from 'zod'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { discardPhotoUpload, photoUploadRouteError } from '@/lib/investigation-photo-upload'
import { photoPath } from '@/lib/investigation-photos'
import { adoptUploadedFile } from '@/lib/upload-adopt'
import { consumeUploadSession, UploadSessionError } from '@/lib/upload-sessions'
import { error } from '@/lib/api-response'
import { randomUUID } from 'node:crypto'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'

export const dynamic = 'force-dynamic'
export const OPTIONS = uploadOptions

export async function POST(req: Request) {
  return uploadCors(req, await uploadPhoto(req))
}

/**
 * Das Bild ist bereits über `/api/uploads` eingetroffen und geprüft; hier
 * reisen nur noch Titel und Ticket. Dasselbe Muster nutzen Clips und Asservate.
 */
async function uploadPhoto(req: Request) {
  let stored: string | undefined
  try {
    const user = await requirePermission('investigations:manage')

    const { uploadId, title } = z
      .object({ uploadId: z.string().trim().min(1).max(64), title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(await req.json())

    const file = await consumeUploadSession(uploadId, user.id, 'PHOTO', (source, extension) =>
      adoptUploadedFile(source, photoPath(`${randomUUID()}${extension}`)),
    )
    stored = file.filename

    const photo = await prisma.$transaction(async (tx) => {
      const created = await tx.investigationPhoto.create({
        data: {
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          title,
          uploadedById: user.id,
        },
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
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return photoUploadRouteError(cause)
  }
}
