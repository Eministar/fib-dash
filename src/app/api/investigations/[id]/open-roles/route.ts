import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { INVESTIGATION_PERSON_ROLE_LABELS, canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { readOpenRoles } from '@/lib/investigation-templates'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

async function loadInvestigation(id: string) {
  return prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude })
}

/**
 * Offene Rolle mit einer echten Person besetzen: legt die Verknüpfung mit
 * der Rolle aus der Vorlage an und entfernt den Platzhalter.
 * Body: `{ roleId, personId, note? }`
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const investigation = await loadInvestigation(id)
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const current = await prisma.investigation.findUnique({ where: { id }, select: { openRoles: true, updatedAt: true } })
    if (!current) return notFound('Ermittlungsakte')
    const openRoles = readOpenRoles(current?.openRoles)
    const slot = openRoles.find((entry) => entry.id === cleanText(body.roleId))
    if (!slot) return notFound('Offene Rolle')

    const personId = cleanText(body.personId)
    if (!personId) return error('Person ist erforderlich')
    const person = await prisma.person.findUnique({ where: { id: personId } })
    if (!person) return notFound('Person')

    const note = cleanText(body.note) || (slot.label !== INVESTIGATION_PERSON_ROLE_LABELS[slot.role] ? slot.label : null)
    try {
      const changed = await prisma.$transaction(async tx => {
        const result = await tx.investigation.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { openRoles: openRoles.filter((entry) => entry.id !== slot.id) } })
        if (!result.count) return false
        await tx.investigationPerson.create({ data: { investigationId: id, personId, role: slot.role, note } })
        return true
      })
      if (!changed) return error('Die Akte wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.', 409)
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) return error('Diese Person ist bereits in dieser Rolle verknüpft', 409)
      throw cause
    }

    await createAuditLog({
      action: 'INVESTIGATION_PERSON_LINKED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: ${person.firstName} ${person.lastName} als „${slot.label}“ zugeordnet`,
    })
    return success({ roleId: slot.id }, 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

/** Platzhalter verwerfen, wenn es die Rolle in diesem Fall nicht gibt. Body: `{ roleId }` */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const investigation = await loadInvestigation(id)
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const current = await prisma.investigation.findUnique({ where: { id }, select: { openRoles: true, updatedAt: true } })
    if (!current) return notFound('Ermittlungsakte')
    const openRoles = readOpenRoles(current?.openRoles)
    const slot = openRoles.find((entry) => entry.id === cleanText(body.roleId))
    if (!slot) return notFound('Offene Rolle')

    const changed = await prisma.investigation.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { openRoles: openRoles.filter((entry) => entry.id !== slot.id) } })
    if (!changed.count) return error('Die Akte wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.', 409)
    await createAuditLog({
      action: 'INVESTIGATION_UPDATED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: offene Rolle „${slot.label}“ verworfen`,
    })
    return success({ roleId: slot.id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
