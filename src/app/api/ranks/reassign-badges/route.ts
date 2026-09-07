import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { formatBadgeNumber, parseBadgeNumberToInt, rankHasBadgeRange } from '@/lib/badge-number'
import { getBlacklistedBadgeRows } from '@/lib/badge-blacklist'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { queueAgentRoleSync } from '@/lib/discord-integration'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'

type PlannedBadgeChange = {
  agentId: string
  agentName: string
  firstName: string
  lastName: string
  discordId: string | null
  status: string
  rankName: string
  oldBadgeNumber: string
  newBadgeNumber: string
}

export async function POST(_req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN'], ['ranks:manage'])
    const prefix = await getBadgePrefix()

    const [agents, blacklistedBadges] = await Promise.all([
      prisma.agent.findMany({
        where: { status: { not: 'TERMINATED' } },
        include: { rank: true },
        orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }, { createdAt: 'asc' }],
      }),
      getBlacklistedBadgeRows(),
    ])

    const reserved = new Set<number>()
    for (const blacklistedBadge of blacklistedBadges) {
      const n = parseBadgeNumberToInt(blacklistedBadge.badgeNumber, prefix)
      if (n !== null) reserved.add(n)
    }
    for (const agent of agents) {
      if (rankHasBadgeRange(agent.rank)) continue
      const n = parseBadgeNumberToInt(agent.badgeNumber, prefix)
      if (n !== null) reserved.add(n)
    }

    const changes: PlannedBadgeChange[] = []
    for (const agent of agents) {
      if (!rankHasBadgeRange(agent.rank)) continue

      let nextNumber: number | null = null
      for (let n = agent.rank.badgeMin; n <= agent.rank.badgeMax; n++) {
        if (!reserved.has(n)) {
          nextNumber = n
          break
        }
      }

      if (nextNumber === null) {
        return error(`Nicht genug freie Dienstnummern im Bereich ${agent.rank.badgeMin}-${agent.rank.badgeMax} für ${agent.rank.name}`)
      }

      reserved.add(nextNumber)
      const newBadgeNumber = formatBadgeNumber(nextNumber, prefix)
      if (newBadgeNumber !== agent.badgeNumber) {
        changes.push({
          agentId: agent.id,
          agentName: `${agent.firstName} ${agent.lastName}`,
          firstName: agent.firstName,
          lastName: agent.lastName,
          discordId: agent.discordId,
          status: agent.status,
          rankName: agent.rank.name,
          oldBadgeNumber: agent.badgeNumber,
          newBadgeNumber,
        })
      }
    }

    if (changes.length === 0) {
      return success({ updated: 0, changes: [] })
    }

    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.agent.update({
          where: { id: change.agentId },
          data: { badgeNumber: change.newBadgeNumber },
        })
        await tx.auditLog.create({
          data: {
            action: 'AGENT_BADGE_REASSIGNED',
            userId: user.id,
            agentId: change.agentId,
            oldValue: change.oldBadgeNumber,
            newValue: change.newBadgeNumber,
            details: `${change.agentName}: ${change.oldBadgeNumber} -> ${change.newBadgeNumber} (${change.rankName})`,
          },
        })
      }
    })

    await createAuditLog({
      action: 'BADGE_NUMBERS_REASSIGNED',
      userId: user.id,
      details: `${changes.length} Dienstnummern anhand der Rangbereiche neu vergeben`,
    })

    await Promise.all(changes.map((change) => syncLinkedUserDisplayNameForAgent({
      badgeNumber: change.newBadgeNumber,
      firstName: change.firstName,
      lastName: change.lastName,
      discordId: change.discordId,
      status: change.status,
    })))

    for (const change of changes) {
      queueAgentRoleSync(change.agentId)
    }

    return success({ updated: changes.length, changes })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
