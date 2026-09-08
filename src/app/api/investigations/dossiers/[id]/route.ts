import { requirePermission } from '@/lib/auth'
import { success, notFound } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { dossierRouteError, dossierSchema, saveDossier, DossierError } from '@/lib/dossiers-server'
import { investigationVisibilityWhere } from '@/lib/investigations'

type Context = { params: Promise<{ id: string }> }
export async function GET(_req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:view')
    const item = await prisma.dossier.findUnique({ where: { id: (await params).id }, include: {
      photo: { select: { id: true, title: true } }, parent: { select: { id: true, title: true } },
      persons: { select: { id: true, personNumber: true, firstName: true, lastName: true } },
      investigations: { where: investigationVisibilityWhere(user), select: { id: true, caseNumber: true, title: true } },
      vehicles: { select: { id: true, vehicleNumber: true, plate: true, model: true }, orderBy: { vehicleNumber: 'asc' } },
      clips: { where: { investigation: investigationVisibilityWhere(user) }, select: { id: true, title: true, recordedAt: true }, orderBy: { createdAt: 'desc' } },
    } })
    return item ? success(item) : notFound('Akte')
  } catch (cause) { return dossierRouteError(cause) }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:manage')
    return success(await saveDossier((await params).id, dossierSchema.partial().parse(await req.json()), user))
  } catch (cause) { return dossierRouteError(cause) }
}
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:delete')
    const { id } = await params
    await prisma.$transaction(async tx => {
      if (await tx.dossier.count({ where: { parentId: id } })) throw new DossierError('Diese Akte enthält Unterakten. Bitte zuerst verschieben oder entfernen.')
      const deleted = await tx.dossier.delete({ where: { id } })
      await createAuditLog({ action: 'DOSSIER_DELETED', userId: user.id, oldValue: JSON.stringify(deleted) }, tx)
    })
    return success({ id })
  } catch (cause) { return dossierRouteError(cause) }
}
