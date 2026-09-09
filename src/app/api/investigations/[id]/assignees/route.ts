import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { agentDisplayName, cleanText, routeError } from '@/lib/investigations-server'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { queueDiscordInvestigationEvent } from '@/lib/discord-integration'

export const dynamic = 'force-dynamic'

const assigneeSelect = {
  id: true,
  agentId: true,
  createdAt: true,
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      rank: { select: { id: true, name: true, color: true } },
    },
  },
  addedBy: { select: { id: true, displayName: true } },
} as const

/**
 * Weist der Akte einen einzelnen Ermittler zu. Bewusst getrennt vom
 * Listen-Ersetzen im PATCH: so ueberschreiben zwei Leute, die gleichzeitig
 * jemanden hinzufuegen, nicht gegenseitig ihre Aenderung.
 */
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

    const agentId = cleanText(body.agentId)
    if (!agentId) return error('Agent ist erforderlich')

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true },
    })
    if (!agent) return notFound('Agent')

    try {
      const assignee = await prisma.investigationAssignee.create({
        data: { investigationId: id, agentId, addedById: user.id },
        select: assigneeSelect,
      })

      await createAuditLog({
        action: 'INVESTIGATION_ASSIGNEE_ADDED',
        userId: user.id,
        agentId,
        details: `Akte ${investigation.caseNumber}: ${agentDisplayName(agent)} als Ermittler zugewiesen`,
      })

      // Verschlusssachen filtert `sendDiscordInvestigationEvent` selbst heraus:
      // die Zuweisung zu einer geheimen Akte darf nicht im offenen Channel
      // stehen. Der Zugewiesene sieht sie im Dashboard.
      queueDiscordInvestigationEvent({
        type: 'assignee',
        caseNumber: investigation.caseNumber,
        title: investigation.title,
        classified: investigation.classified,
        actorName: user.displayName,
        rows: [
          { label: 'Ermittler', value: agentDisplayName(agent) },
          { label: 'Dienstnummer', value: agent.badgeNumber },
        ],
      })

      // Ohne verknuepftes Discord-Konto laesst sich der Agent keinem
      // Dashboard-Benutzer zuordnen – die Zuweisung steht dann zwar in der
      // Akte, oeffnet aber keine Verschlusssache.
      return success(
        { assignee, warning: agent.discordId ? null : 'Agent hat keine Discord-Verknüpfung und erhält dadurch keinen Zugriff auf Verschlusssachen.' },
        201,
      )
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) {
        return error('Dieser Agent ist der Akte bereits zugewiesen', 409)
      }
      throw cause
    }
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
