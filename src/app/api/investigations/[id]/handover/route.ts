import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { notifyInvestigationTeam } from '@/lib/notifications-server'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  handoverEntryContent,
  investigationAccessInclude,
  investigationDetailInclude,
  serializeBigInts,
} from '@/lib/investigations'
import { agentDisplayName, cleanText, routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

const NOTE_MAX = 5000

/**
 * Fallführung mit Übergabenotiz wechseln. Anders als das reine Umstellen im
 * Bearbeiten-Dialog landet die Übergabe als Eintrag in der Chronologie, und
 * die bisherige Fallführung bleibt auf Wunsch als Ermittler zugewiesen –
 * sonst verlöre sie bei Verschlusssachen sofort den Zugriff.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const leadAgentId = cleanText(body.leadAgentId)
    const note = cleanText(body.note)
    const keepPrevious = body.keepPreviousAsAssignee !== false
    if (!leadAgentId) return error('Bitte die neue Fallführung wählen')
    if (!note) return error('Bitte eine Übergabenotiz schreiben')
    if (note.length > NOTE_MAX) return error(`Die Übergabenotiz ist zu lang (max. ${NOTE_MAX} Zeichen)`)

    const existing = await prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude })
    if (!existing) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, existing)) return forbidden()
    if (existing.leadAgentId === leadAgentId) return error('Dieser Agent führt die Akte bereits')

    const [previousLead, nextLead] = await Promise.all([
      existing.leadAgentId
        ? prisma.agent.findUnique({ where: { id: existing.leadAgentId }, select: { id: true, firstName: true, lastName: true, badgeNumber: true } })
        : null,
      prisma.agent.findFirst({
        where: { id: leadAgentId, status: { not: 'TERMINATED' } },
        select: { id: true, firstName: true, lastName: true, badgeNumber: true },
      }),
    ])
    if (!nextLead) return notFound('Agent')

    const investigation = await prisma.$transaction(async (tx) => {
      if (keepPrevious && previousLead) {
        await tx.investigationAssignee.upsert({
          where: { investigationId_agentId: { investigationId: id, agentId: previousLead.id } },
          create: { investigationId: id, agentId: previousLead.id, addedById: user.id },
          update: {},
        })
      }
      await tx.investigationEntry.create({
        data: {
          investigationId: id,
          kind: 'NOTE',
          title: 'Übergabe der Fallführung',
          content: handoverEntryContent(agentDisplayName(previousLead), agentDisplayName(nextLead), note),
          occurredAt: new Date(),
          participants: [],
          createdById: user.id,
        },
      })
      return tx.investigation.update({
        where: { id },
        data: { leadAgent: { connect: { id: nextLead.id } } },
        include: investigationDetailInclude,
      })
    })

    await createAuditLog({
      action: 'INVESTIGATION_HANDOVER',
      userId: user.id,
      details: `Ermittlungsakte ${investigation.caseNumber}: Fallführung von ${agentDisplayName(previousLead) || '—'} an ${agentDisplayName(nextLead)} übergeben`,
      newValue: note.slice(0, 2000),
    })
    await notifyInvestigationTeam({ investigation, actorId: user.id, newLeadAgentId: nextLead.id })

    return success(serializeBigInts(investigation))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
