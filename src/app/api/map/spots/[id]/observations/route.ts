import { NextRequest } from 'next/server'

import { notFound, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { mapRouteError, observationSchema } from '@/lib/map-server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('map:manage')
    const { id } = await params
    const data = observationSchema.parse(await req.json())

    // Prisma meldet den fehlenden Punkt sonst erst als Fremdschlüsselfehler.
    const spot = await prisma.mapSpot.findUnique({ where: { id }, select: { title: true } })
    if (!spot) return notFound('Markierung')

    const observation = await prisma.mapSpotObservation.create({
      data: { spotId: id, note: data.note, observedAt: data.observedAt, createdById: user.id },
    })

    await createAuditLog({
      action: 'MAP_OBSERVATION_ADDED',
      userId: user.id,
      details: `Beobachtung an „${spot.title}“`,
    })

    return success({ id: observation.id }, 201)
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}
