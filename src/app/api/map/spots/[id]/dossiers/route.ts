import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit/audit'
import { dossierRouteError } from '@/lib/investigations/dossiers-server'
import { queueForumTask, syncDossierForum } from '@/lib/investigations/investigation-forum'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    await requirePermission('map:view')
    const { id } = await params
    const { dossierId, linked } = z.object({ dossierId: z.string().min(1).max(191), linked: z.boolean() }).strict().parse(await req.json())
    await prisma.$transaction(async tx => {
      await tx.mapSpot.findUniqueOrThrow({ where: { id } })
      await tx.dossier.update({ where: { id: dossierId }, data: { mapSpots: linked ? { connect: { id } } : { disconnect: { id } } } })
      await createAuditLog({ action: 'DOSSIER_UPDATED', userId: user.id, newValue: JSON.stringify({ dossierId, mapSpotId: id, linked }) }, tx)
    })
    queueForumTask('Familienakte im Forum', () => syncDossierForum(dossierId))
    return success({ dossierId, linked })
  } catch (cause) { return dossierRouteError(cause) }
}
