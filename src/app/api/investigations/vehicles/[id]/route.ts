import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const link = await prisma.investigationVehicle.findUnique({
      where: { id },
      include: {
        vehicle: { select: { vehicleNumber: true, plate: true, model: true } },
        investigation: { include: investigationAccessInclude },
      },
    })
    if (!link) return notFound('Verknüpfung')
    if (!canAccessInvestigation(user, link.investigation)) return forbidden()

    await prisma.investigationVehicle.delete({ where: { id } })

    await createAuditLog({
      action: 'INVESTIGATION_VEHICLE_UNLINKED',
      userId: user.id,
      details: `Akte ${link.investigation.caseNumber}: Fahrzeug ${link.vehicle.vehicleNumber} entfernt`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
