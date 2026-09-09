import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { investigationVisibilityWhere } from '@/lib/investigations'
import { cleanText, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const person = await prisma.person.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        vehiclesOwned: { orderBy: { createdAt: 'desc' } },
        // Verbindungen in beide Richtungen: gespeichert wird nur eine Zeile,
        // die Personenakte zeigt trotzdem das vollständige Umfeld.
        linksFrom: { orderBy: { createdAt: 'asc' }, include: { toPerson: true } },
        linksTo: { orderBy: { createdAt: 'asc' }, include: { fromPerson: true } },
        investigations: {
          // Verschlusssachen tauchen in der Personenakte nicht auf, wenn der
          // Benutzer sie nicht ohnehin sehen dürfte.
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
    if (!person) return notFound('Person')

    return success(person)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.person.findUnique({ where: { id } })
    if (!existing) return notFound('Person')

    const data: Prisma.PersonUpdateInput = {}

    if (body.firstName !== undefined) {
      const firstName = cleanText(body.firstName)
      if (!firstName) return error('Vorname ist erforderlich')
      data.firstName = firstName.slice(0, 100)
    }

    if (body.lastName !== undefined) {
      const lastName = cleanText(body.lastName)
      if (!lastName) return error('Nachname ist erforderlich')
      data.lastName = lastName.slice(0, 100)
    }

    if (body.alias !== undefined) data.alias = cleanText(body.alias).slice(0, 100) || null
    if (body.identifier !== undefined) data.identifier = cleanText(body.identifier).slice(0, 100) || null
    if (body.dateOfBirth !== undefined) data.dateOfBirth = parseDate(body.dateOfBirth)
    if (body.phone !== undefined) data.phone = cleanText(body.phone).slice(0, 64) || null
    if (body.photoUrl !== undefined) data.photoUrl = cleanText(body.photoUrl).slice(0, 2048) || null
    if (body.photoId !== undefined) {
      const photoId = cleanText(body.photoId) || null
      if (photoId && !(await prisma.investigationPhoto.findUnique({ where: { id: photoId }, select: { id: true } }))) {
        return notFound('Bild')
      }
      data.photo = photoId ? { connect: { id: photoId } } : { disconnect: true }
    }
    if (body.notes !== undefined) data.notes = cleanText(body.notes) || null
    if (body.wanted !== undefined) data.wanted = body.wanted === true
    if (body.dangerous !== undefined) data.dangerous = body.dangerous === true

    const person = await prisma.person.update({ where: { id }, data })

    await createAuditLog({
      action: 'PERSON_UPDATED',
      userId: user.id,
      details: `Personenakte ${person.personNumber}: ${person.firstName} ${person.lastName} bearbeitet`,
    })

    return success(person)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:delete')
    const { id } = await params

    const existing = await prisma.person.findUnique({
      where: { id },
      include: { _count: { select: { investigations: true } } },
    })
    if (!existing) return notFound('Person')

    if (existing._count.investigations > 0) {
      return error(
        `Person ist noch mit ${existing._count.investigations} Akte(n) verknüpft. Verknüpfungen zuerst lösen.`,
        409,
      )
    }

    await prisma.person.delete({ where: { id } })

    await createAuditLog({
      action: 'PERSON_DELETED',
      userId: user.id,
      details: `Personenakte ${existing.personNumber}: ${existing.firstName} ${existing.lastName} gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
