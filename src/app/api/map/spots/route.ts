import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { createSpotSchema, mapRouteError, serializeSpot, spotInclude, visibleSpotInclude } from '@/lib/map-server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requirePermission('map:view')
    const spots = await prisma.mapSpot.findMany({ include: visibleSpotInclude(user), orderBy: { createdAt: 'desc' } })
    return success(spots.map(serializeSpot))
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('map:manage')
    const data = createSpotSchema.parse(await req.json())

    const spot = await prisma.mapSpot.create({
      data: { ...data, createdById: user.id },
      include: spotInclude,
    })

    await createAuditLog({
      action: 'MAP_SPOT_CREATED',
      userId: user.id,
      details: `Markierung „${spot.title}“ gesetzt (${spot.x.toFixed(1)} / ${spot.y.toFixed(1)})`,
    })

    return success(serializeSpot(spot), 201)
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}
