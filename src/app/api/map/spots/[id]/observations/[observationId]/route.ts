import { NextRequest } from 'next/server'

import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { mapRouteError } from '@/lib/map-server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; observationId: string }> }

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('map:manage')
    const { id, observationId } = await params

    // Die Spot-Id muss passen, sonst löscht ein geratener Pfad fremde Einträge.
    const deleted = await prisma.mapSpotObservation.deleteMany({ where: { id: observationId, spotId: id } })
    if (deleted.count === 0) return notFound('Beobachtung')

    await createAuditLog({ action: 'MAP_OBSERVATION_DELETED', userId: user.id, details: observationId })
    return success({ id: observationId })
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}
