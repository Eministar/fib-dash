import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success, notFound } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { dossierRouteError } from '@/lib/dossiers-server'

type Context = { params: Promise<{ id: string }> }
const groupId = z.string().trim().min(1).max(191)

/**
 * Rechtevergabe läuft bewusst über eigene Routen statt über das Akten-Update:
 * jede Freigabe und jeder Entzug steht einzeln im Audit-Log. Gruppennamen
 * landen dort nicht, weil das Log breiter lesbar ist als die Gruppen.
 */
export async function POST(req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const input = z.object({ groupId }).strict().parse(await req.json())
    const [dossier, group] = await Promise.all([
      prisma.dossier.findUnique({ where: { id }, select: { id: true, title: true } }),
      prisma.leadershipGroup.findUnique({ where: { id: input.groupId }, select: { id: true } }),
    ])
    if (!dossier) return notFound('Akte')
    if (!group) return notFound('Ermittlungsgruppe')
    await prisma.$transaction(async tx => {
      await tx.dossierAccessGroup.upsert({
        where: { dossierId_groupId: { dossierId: id, groupId: group.id } },
        create: { dossierId: id, groupId: group.id, addedById: user.id },
        update: {},
      })
      await createAuditLog({ action: 'DOSSIER_ACCESS_GRANTED', userId: user.id, details: `Dauerakte „${dossier.title}“: Ermittlungsgruppe freigegeben`, newValue: group.id }, tx)
    })
    return success({ dossierId: id, groupId: group.id }, 201)
  } catch (cause) { return dossierRouteError(cause) }
}

export async function DELETE(req: Request, { params }: Context) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const removedId = groupId.parse(new URL(req.url).searchParams.get('groupId') ?? '')
    const dossier = await prisma.dossier.findUnique({ where: { id }, select: { title: true } })
    if (!dossier) return notFound('Akte')
    await prisma.$transaction(async tx => {
      const removed = await tx.dossierAccessGroup.deleteMany({ where: { dossierId: id, groupId: removedId } })
      if (removed.count) await createAuditLog({ action: 'DOSSIER_ACCESS_REVOKED', userId: user.id, details: `Dauerakte „${dossier.title}“: Ermittlungsgruppe entfernt`, oldValue: removedId }, tx)
    })
    return success({ dossierId: id, groupId: removedId })
  } catch (cause) { return dossierRouteError(cause) }
}
