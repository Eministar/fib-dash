import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { routeError } from '@/lib/investigations/investigations-server'
import { photoDescriptionSchema } from '@/lib/investigations/photo-description'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const data = z.object({ description: photoDescriptionSchema }).strict().parse(await req.json())
    const existing = await prisma.investigationPhoto.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return error('Bild nicht gefunden', 404)
    const photo = await prisma.$transaction(async tx => {
      const updated = await tx.investigationPhoto.update({ where: { id }, data, select: { id: true, title: true, description: true } })
      await createAuditLog({ action: 'PHOTO_UPDATED', userId: user.id, details: `Bildbeschreibung geändert: „${updated.title}“` }, tx)
      return updated
    })
    return success({ ...photo, url: `/api/investigations/photos/${photo.id}/image` })
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? 'Ungültige Beschreibung')
    if (cause instanceof SyntaxError) return error('Ungültige Anfrage')
    return routeError(cause)
  }
}
