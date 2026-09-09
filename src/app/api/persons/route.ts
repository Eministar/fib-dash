import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { cleanText, nextPersonNumber, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const { searchParams } = req.nextUrl

    const search = searchParams.get('search')?.trim()
    const wantedOnly = searchParams.get('wanted') === 'true'

    const where: Prisma.PersonWhereInput = {}
    if (wantedOnly) where.wanted = true
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { alias: { contains: search } },
        { identifier: { contains: search } },
        { personNumber: { contains: search } },
      ]
    }

    const persons = await prisma.person.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        createdBy: { select: { id: true, displayName: true } },
        // Nur Akten mitzählen, die der Benutzer auch sehen darf – sonst
        // verrät die Zahl die Existenz von Verschlusssachen.
        _count: {
          select: { investigations: { where: { investigation: investigationVisibilityWhere(user) } } },
        },
      },
    })

    return success(persons)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:manage')
    const body = await req.json()

    const firstName = cleanText(body.firstName)
    const lastName = cleanText(body.lastName)
    if (!firstName || !lastName) return error('Vor- und Nachname sind erforderlich')
    if (firstName.length > 100 || lastName.length > 100) return error('Name ist zu lang (max. 100 Zeichen)')

    const photoId = cleanText(body.photoId) || null
    if (photoId && !(await prisma.investigationPhoto.findUnique({ where: { id: photoId }, select: { id: true } }))) {
      return notFound('Bild')
    }

    const personNumber = await nextPersonNumber()

    const person = await prisma.person.create({
      data: {
        personNumber,
        firstName,
        lastName,
        alias: cleanText(body.alias).slice(0, 100) || null,
        identifier: cleanText(body.identifier).slice(0, 100) || null,
        dateOfBirth: parseDate(body.dateOfBirth),
        phone: cleanText(body.phone).slice(0, 64) || null,
        photoUrl: cleanText(body.photoUrl).slice(0, 2048) || null,
        photoId,
        notes: cleanText(body.notes) || null,
        wanted: body.wanted === true,
        dangerous: body.dangerous === true,
        createdById: user.id,
      },
    })

    await createAuditLog({
      action: 'PERSON_CREATED',
      userId: user.id,
      details: `Personenakte ${personNumber}: ${firstName} ${lastName} angelegt`,
    })

    return success(person, 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
