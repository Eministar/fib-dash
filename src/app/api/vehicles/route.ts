import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { cleanText, nextVehicleNumber, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const { searchParams } = req.nextUrl

    const search = searchParams.get('search')?.trim()
    const flaggedOnly = searchParams.get('flagged') === 'true'

    const where: Prisma.VehicleWhereInput = {}
    if (flaggedOnly) where.OR = [{ stolen: true }, { wanted: true }]
    if (search) {
      where.AND = [
        {
          OR: [
            { plate: { contains: search } },
            { model: { contains: search } },
            { vehicleNumber: { contains: search } },
            { ownerPerson: { lastName: { contains: search } } },
            { ownerPerson: { alias: { contains: search } } },
          ],
        },
      ]
    }

    const vehicles = await prisma.vehicle.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        ownerPerson: true,
        // Nur sichtbare Akten zaehlen – sonst verraet die Zahl, dass es zu
        // diesem Fahrzeug eine Verschlusssache gibt.
        _count: {
          select: { investigations: { where: { investigation: investigationVisibilityWhere(user) } } },
        },
      },
    })

    return success(vehicles)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:manage')
    const body = await req.json()

    const plate = cleanText(body.plate).toUpperCase().slice(0, 32) || null
    const model = cleanText(body.model).slice(0, 120) || null
    if (!plate && !model) return error('Kennzeichen oder Modell ist erforderlich')

    const ownerPersonId = cleanText(body.ownerPersonId) || null
    if (ownerPersonId) {
      const owner = await prisma.person.findUnique({ where: { id: ownerPersonId }, select: { id: true } })
      if (!owner) return notFound('Halter')
    }

    const photoId = cleanText(body.photoId) || null
    if (photoId && !(await prisma.investigationPhoto.findUnique({ where: { id: photoId }, select: { id: true } }))) {
      return notFound('Bild')
    }

    const vehicleNumber = await nextVehicleNumber()

    const vehicle = await prisma.vehicle.create({
      data: {
        vehicleNumber,
        plate,
        model,
        color: cleanText(body.color).slice(0, 60) || null,
        notes: cleanText(body.notes) || null,
        stolen: body.stolen === true,
        wanted: body.wanted === true,
        ownerPersonId,
        photoId,
        createdById: user.id,
      },
      include: { ownerPerson: true },
    })

    await createAuditLog({
      action: 'VEHICLE_CREATED',
      userId: user.id,
      details: `Fahrzeug ${vehicleNumber}: ${plate ?? model} erfasst`,
    })

    return success(vehicle, 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
