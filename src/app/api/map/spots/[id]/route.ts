import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { requirePermission } from '@/lib/auth'
import { mapRouteError, serializeSpot, spotInclude, updateSpotSchema } from '@/lib/map-server'
import { prisma } from '@/lib/prisma'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('map:manage')
    const { id } = await params
    const data = updateSpotSchema.parse(await req.json())
    if (Object.keys(data).length === 0) return error('Keine Änderungen übergeben')

    const spot = await prisma.mapSpot.update({ where: { id }, data, include: spotInclude })

    // Verschieben und Bearbeiten laufen über dieselbe Route, sollen im Protokoll
    // aber unterscheidbar bleiben.
    const moved = data.x !== undefined || data.y !== undefined
    await createAuditLog({
      action: moved ? 'MAP_SPOT_MOVED' : 'MAP_SPOT_UPDATED',
      userId: user.id,
      details: moved
        ? `Markierung „${spot.title}“ verschoben (${spot.x.toFixed(1)} / ${spot.y.toFixed(1)})`
        : `Markierung „${spot.title}“ bearbeitet`,
    })

    return success(serializeSpot(spot))
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('map:manage')
    const { id } = await params

    const spot = await prisma.mapSpot.delete({ where: { id } })

    await createAuditLog({
      action: 'MAP_SPOT_DELETED',
      userId: user.id,
      details: `Markierung „${spot.title}“ gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return mapRouteError(cause)
  }
}
