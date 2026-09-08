import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        ownerPerson: true,
        createdBy: { select: { id: true, displayName: true } },
        investigations: {
          where: { investigation: investigationVisibilityWhere(user) },
          orderBy: { createdAt: 'desc' },
          include: {
            investigation: {
              select: {
                id: true,
                caseNumber: true,
                title: true,
                status: true,
                priority: true,
                classified: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    })
    if (!vehicle) return notFound('Fahrzeug')

    return success(vehicle)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.vehicle.findUnique({ where: { id } })
    if (!existing) return notFound('Fahrzeug')

    const data: Prisma.VehicleUpdateInput = {}

    if (body.plate !== undefined) data.plate = cleanText(body.plate).toUpperCase().slice(0, 32) || null
    if (body.model !== undefined) data.model = cleanText(body.model).slice(0, 120) || null
    if (body.color !== undefined) data.color = cleanText(body.color).slice(0, 60) || null
    if (body.notes !== undefined) data.notes = cleanText(body.notes) || null
    if (body.stolen !== undefined) data.stolen = body.stolen === true
    if (body.wanted !== undefined) data.wanted = body.wanted === true

    if (body.ownerPersonId !== undefined) {
      const ownerPersonId = cleanText(body.ownerPersonId) || null
      if (ownerPersonId) {
        const owner = await prisma.person.findUnique({
          where: { id: ownerPersonId },
          select: { id: true },
        })
        if (!owner) return notFound('Halter')
        data.ownerPerson = { connect: { id: ownerPersonId } }
      } else {
        data.ownerPerson = { disconnect: true }
      }
    }

    const plate = data.plate ?? existing.plate
    const model = data.model ?? existing.model
    if (!plate && !model) return error('Kennzeichen oder Modell ist erforderlich')

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data,
      include: { ownerPerson: true },
    })

    await createAuditLog({
      action: 'VEHICLE_UPDATED',
      userId: user.id,
      details: `Fahrzeug ${vehicle.vehicleNumber}: ${vehicle.plate ?? vehicle.model} bearbeitet`,
    })

    return success(vehicle)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:delete')
    const { id } = await params

    const existing = await prisma.vehicle.findUnique({
      where: { id },
      include: { _count: { select: { investigations: true } } },
    })
    if (!existing) return notFound('Fahrzeug')

    if (existing._count.investigations > 0) {
      return error(
        `Fahrzeug ist noch mit ${existing._count.investigations} Akte(n) verknüpft. Verknüpfungen zuerst lösen.`,
        409,
      )
    }

    await prisma.vehicle.delete({ where: { id } })

    await createAuditLog({
      action: 'VEHICLE_DELETED',
      userId: user.id,
      details: `Fahrzeug ${existing.vehicleNumber}: ${existing.plate ?? existing.model} gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
