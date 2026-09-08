import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: investigationAccessInclude,
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const vehicleId = cleanText(body.vehicleId)
    if (!vehicleId) return error('Fahrzeug ist erforderlich')

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) return notFound('Fahrzeug')

    try {
      const link = await prisma.investigationVehicle.create({
        data: { investigationId: id, vehicleId, note: cleanText(body.note) || null },
        include: { vehicle: { include: { ownerPerson: true } } },
      })

      await createAuditLog({
        action: 'INVESTIGATION_VEHICLE_LINKED',
        userId: user.id,
        details: `Akte ${investigation.caseNumber}: Fahrzeug ${vehicle.vehicleNumber} (${vehicle.plate ?? vehicle.model}) verknüpft`,
      })

      return success(link, 201)
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) {
        return error('Dieses Fahrzeug ist bereits mit der Akte verknüpft', 409)
      }
      throw cause
    }
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
