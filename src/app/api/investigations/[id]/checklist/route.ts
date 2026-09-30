import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { TEMPLATE_LIMITS, newChecklistItem, readChecklist } from '@/lib/investigation-templates'

export const dynamic = 'force-dynamic'

/**
 * Checkliste einer Akte bearbeiten.
 * Body: `{ action: 'toggle', itemId, done }` · `{ action: 'add', label }` · `{ action: 'remove', itemId }`
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const current = await prisma.investigation.findUnique({ where: { id }, select: { checklist: true, updatedAt: true } })
    if (!current) return notFound('Ermittlungsakte')
    const checklist = readChecklist(current?.checklist)
    const action = cleanText(body.action)
    let auditDetails: string

    if (action === 'toggle') {
      if (typeof body.done !== 'boolean') return error('Erledigt muss ein Wahrheitswert sein')
      const item = checklist.find((entry) => entry.id === cleanText(body.itemId))
      if (!item) return notFound('Checklisten-Punkt')
      item.done = body.done === true
      item.doneAt = item.done ? new Date().toISOString() : null
      item.doneBy = item.done ? user.displayName : null
      auditDetails = `„${item.label}“ ${item.done ? 'erledigt' : 'wieder geöffnet'}`
    } else if (action === 'add') {
      if (checklist.length >= TEMPLATE_LIMITS.checklistItems) return error(`Höchstens ${TEMPLATE_LIMITS.checklistItems} Punkte pro Checkliste`)
      const item = newChecklistItem(cleanText(body.label))
      if (!item) return error('Bezeichnung ist erforderlich')
      checklist.push(item)
      auditDetails = `Punkt „${item.label}“ hinzugefügt`
    } else if (action === 'remove') {
      const index = checklist.findIndex((entry) => entry.id === cleanText(body.itemId))
      if (index < 0) return notFound('Checklisten-Punkt')
      const [removed] = checklist.splice(index, 1)
      auditDetails = `Punkt „${removed.label}“ entfernt`
    } else {
      return error('Unbekannte Aktion')
    }

    const changed = await prisma.investigation.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { checklist } })
    if (!changed.count) return error('Die Akte wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.', 409)
    await createAuditLog({
      action: 'INVESTIGATION_CHECKLIST_UPDATED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: ${auditDetails}`,
    })
    return success(checklist)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
