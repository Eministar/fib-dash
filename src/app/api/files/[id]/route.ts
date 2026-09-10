import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { deleteStoredFile, fileUploadMetaSchema } from '@/lib/file-uploads'
import { fileUploadRouteError, fileUploadSelect, serializeUpload } from '@/lib/file-upload-queries'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    await requireAuth(undefined, ['uploads:view', 'uploads:manage'])
    const { id } = await params
    const upload = await prisma.fileUpload.findUnique({ where: { id }, select: fileUploadSelect })
    if (!upload) return notFound('Upload')
    return success(serializeUpload(upload))
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

/** Metadaten nachtragen. Die Datei selbst bleibt unangetastet. */
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await requireAuth(undefined, ['uploads:manage'])
    const { id } = await params
    const input = fileUploadMetaSchema.parse(await req.json())

    const existing = await prisma.fileUpload.findUnique({ where: { id }, select: { id: true, title: true } })
    if (!existing) return notFound('Upload')

    const upload = await prisma.fileUpload.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.category !== undefined ? { category: input.category || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef || null } : {}),
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl || null } : {}),
        ...(input.externalUser !== undefined ? { externalUser: input.externalUser || null } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata as object } : {}),
      },
      select: fileUploadSelect,
    })
    await createAuditLog({
      action: 'FILE_UPLOAD_UPDATED',
      userId: user.id,
      oldValue: existing.title,
      newValue: upload.title,
      details: `Upload ${id} bearbeitet`,
    })
    return success(serializeUpload(upload))
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requireAuth(undefined, ['uploads:manage'])
    const { id } = await params
    const upload = await prisma.fileUpload.findUnique({ where: { id }, select: { id: true, title: true, filename: true } })
    if (!upload) return notFound('Upload')

    // Erst die Zeile, dann die Datei: bleibt die Zeile stehen, zeigt die
    // Liste einen Eintrag ohne Inhalt — andersherum liegt eine verwaiste
    // Datei ohne jeden Verweis auf der Platte.
    await prisma.fileUpload.delete({ where: { id } })
    await deleteStoredFile(upload.filename)
    await createAuditLog({ action: 'FILE_UPLOAD_DELETED', userId: user.id, details: `${upload.title} (${id})` })
    return success({ deleted: true })
  } catch (cause) {
    return fileUploadRouteError(cause)
  }
}
