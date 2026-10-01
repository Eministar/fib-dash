import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { agentDisplayName, cleanText, routeError } from '@/lib/investigations-server'
import { appendCustodyEvent, custodyReport, recordCustodyView } from '@/lib/custody-server'
import { currentHolder } from '@/lib/custody'
import { notifyAgents } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

const accessInclude = {
  investigation: { include: investigationAccessInclude },
} as const

/**
 * Beweiskette eines Asservats mit Integritätsprüfung. `?log=1` protokolliert
 * das Einsehen (Dialog, Druckansicht) – das stille Nachladen nicht.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const evidence = await prisma.evidence.findUnique({ where: { id }, include: accessInclude })
    if (!evidence) return notFound('Asservat')
    if (!canAccessInvestigation(user, evidence.investigation)) return forbidden()

    if (req.nextUrl.searchParams.get('log') === '1') await recordCustodyView(evidence, user)

    const report = await custodyReport(id)
    if (!report) return notFound('Asservat')
    return success(report)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

/**
 * Übergabe erfassen: an einen Agent (`toAgentId`) oder eine Stelle
 * (`toHolder`, z. B. „Labor“, „Staatsanwaltschaft“). Ein neuer Verwahrort
 * wird zugleich am Asservat gespeichert.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const evidence = await prisma.evidence.findUnique({ where: { id }, include: accessInclude })
    if (!evidence) return notFound('Asservat')
    if (!canAccessInvestigation(user, evidence.investigation)) return forbidden()

    const toAgentId = cleanText(body.toAgentId) || null
    const agent = toAgentId
      ? await prisma.agent.findUnique({
          where: { id: toAgentId },
          select: { id: true, firstName: true, lastName: true, badgeNumber: true },
        })
      : null
    if (toAgentId && !agent) return notFound('Agent')

    const toHolder = agent ? agentDisplayName(agent) : cleanText(body.toHolder)
    if (!toHolder) return error('Empfänger der Übergabe ist erforderlich')
    if (toHolder.length > 200) return error('Empfänger ist zu lang (max. 200 Zeichen)')

    const location = cleanText(body.location).slice(0, 200) || null
    const note = cleanText(body.note).slice(0, 2000) || null

    const event = await prisma.$transaction(async (tx) => {
      const previous = await tx.evidenceCustodyEvent.findMany({
        where: { chainKey: id, action: 'TRANSFERRED' },
        orderBy: { createdAt: 'asc' },
        select: { action: true, toHolder: true },
      })
      const created = await appendCustodyEvent(tx, evidence, {
        action: 'TRANSFERRED',
        actor: user,
        fromHolder: currentHolder(previous) ?? evidence.storageLocation,
        toHolder,
        location,
        note,
      })
      if (location && location !== evidence.storageLocation) {
        await tx.evidence.update({ where: { id }, data: { storageLocation: location } })
      }
      return created
    })

    await createAuditLog({
      action: 'EVIDENCE_TRANSFERRED',
      userId: user.id,
      agentId: agent?.id,
      details: `Akte ${evidence.investigation.caseNumber}: Asservat ${evidence.itemNumber} übergeben an ${toHolder}`,
    })

    if (agent) {
      await notifyAgents([agent.id], {
        kind: 'EVIDENCE_TRANSFERRED',
        title: `Asservat ${evidence.itemNumber} an dich übergeben`,
        body: `${evidence.title} · ${evidence.investigation.caseNumber}`,
        href: `/investigations/${evidence.investigationId}?tab=asservate`,
        actorId: user.id,
      })
    }

    return success({ id: event.id }, 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
