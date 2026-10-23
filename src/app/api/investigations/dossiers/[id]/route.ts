import { requirePermission } from '@/lib/auth'
import { success, notFound } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { dossierRouteError, dossierSchema, saveDossier } from '@/lib/investigations/dossiers-server'
import { investigationVisibilityWhere } from '@/lib/investigations/investigations'
import { queueForumTask, removeForumPost, syncDossierForum } from '@/lib/investigations/investigation-forum'

type Context = { params: Promise<{ id: string }> }
export async function GET(_req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:view')
    const item = await prisma.dossier.findUnique({ where: { id: (await params).id }, include: {
      photo: { select: { id: true, title: true } },
      leader: { select: { id: true, firstName: true, lastName: true, personNumber: true } },
      photos: { select: { id: true, title: true }, orderBy: { createdAt: 'desc' } },
      persons: { select: { id: true, personNumber: true, firstName: true, lastName: true } },
      investigations: { where: investigationVisibilityWhere(user), select: { id: true, caseNumber: true, title: true, status: true, priority: true, updatedAt: true, createdBy: { select: { id: true, displayName: true } } }, orderBy: { updatedAt: 'desc' } },
      vehicles: { select: { id: true, vehicleNumber: true, plate: true, model: true }, orderBy: { vehicleNumber: 'asc' } },
      mapSpots: { select: { id: true, title: true, category: true, icon: true, x: true, y: true }, orderBy: { title: 'asc' } },
      // Nur Namen: Mitglieder der Gruppen bleiben vertraulich.
      accessGroups: { select: { group: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    } })
    return item ? success(item) : notFound('Akte')
  } catch (cause) { return dossierRouteError(cause) }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:manage')
    const dossier = await saveDossier((await params).id, dossierSchema.partial().parse(await req.json()), user)
    queueForumTask('Familienakte im Forum', () => syncDossierForum(dossier.id))
    return success(dossier)
  } catch (cause) { return dossierRouteError(cause) }
}
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:delete')
    const { id } = await params
    const deleted = await prisma.$transaction(async tx => {
      const row = await tx.dossier.delete({ where: { id } })
      await createAuditLog({ action: 'DOSSIER_DELETED', userId: user.id, oldValue: JSON.stringify(row) }, tx)
      return row
    })
    queueForumTask('Familienakte aus dem Forum entfernen', () => removeForumPost(deleted.discordThreadId))
    return success({ id })
  } catch (cause) { return dossierRouteError(cause) }
}
