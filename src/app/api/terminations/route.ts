import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordHrEvent, queueAgentRoleSync } from '@/lib/discord-integration'
import { releaseTerminatedBadgeNumber } from '@/lib/badge-blacklist'
import { releaseTerminatedCodename, codenameTransaction } from '@/lib/codenames'
import { queueCodenameBoardUpdate } from '@/lib/discord-integration'

export async function GET() {
  try {
    await requirePermission(['terminations:view', 'internal-affairs:view'])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const terminations = await prisma.termination.findMany({
    include: {
      agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, status: true, rankId: true, rank: true } },
      terminatedBy: { select: { displayName: true } },
    },
    orderBy: { terminatedAt: 'desc' },
  })

  return success(terminations)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['terminations:manage', 'internal-affairs:manage'])
    const body = await req.json()

    const { agentId, reason } = body
    if (!agentId || !reason) return error('Agent und Grund sind erforderlich')

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { rank: true } })
    if (!agent) return error('Agent nicht gefunden')
    if (agent.status === 'TERMINATED') return error('Agent ist bereits gekündigt')

    const termination = await codenameTransaction(async (tx) => {
      await tx.agent.update({ where: { id: agentId }, data: { status: 'TERMINATED' } })
      const record = await tx.termination.create({
        data: {
          agentId,
          reason,
          terminatedByUserId: user.id,
          previousRank: agent.rank.name,
          previousBadgeNumber: agent.badgeNumber,
          previousFirstName: agent.firstName,
          previousLastName: agent.lastName,
        },
      })

      await releaseTerminatedBadgeNumber(agent, tx)
      await releaseTerminatedCodename(tx, agentId, user.id)
      return record
    })
    queueCodenameBoardUpdate()

    await createAuditLog({
      action: 'AGENT_TERMINATED',
      userId: user.id,
      agentId,
      details: `${agent.firstName} ${agent.lastName} gekündigt. Grund: ${reason}`,
    })

    queueAgentRoleSync(agentId, 'remove-all')
    queueDiscordHrEvent({
      type: 'termination',
      title: `Kündigung: ${agent.firstName} ${agent.lastName}`,
      agent,
      actor: user,
      fields: [
        { name: 'Grund', value: String(reason), inline: false },
      ],
    })

    return success(termination, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
