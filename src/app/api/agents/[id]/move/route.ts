import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { nextBadgeForRank, rankHasBadgeRange } from '@/lib/badge-number'
import { getBlacklistedBadgeRows, releaseTerminatedBadgeNumberConflicts } from '@/lib/badge-blacklist'
import { createAuditLog } from '@/lib/audit'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { queueDiscordHrEvent, queueAgentRoleSync } from '@/lib/discord-integration'
import { withAgentTrainingRows } from '@/lib/agent-trainings'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'

const includeAgent = {
  rank: true,
  trainings: { include: { training: { include: { minRank: true } } } },
} as const

/**
 * Office zwischen Rängen verschieben (z. B. per Drag & Drop). Vergibt ggf. eine freie
 * Dienstnummer gemäß Ziel-Badge-Bereich, sonst behält die bisherige Nummer.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const { id } = await params
    const body = await req.json()
    const targetRankId = body?.targetRankId as string | undefined
    if (!targetRankId) return error('Ziel-Rang fehlt')

    const agent = await prisma.agent.findUnique({ where: { id }, include: { rank: true } })
    if (!agent) return notFound('Agent')

    if (agent.rankId === targetRankId) {
      const [same, trainings] = await Promise.all([
        prisma.agent.findUnique({ where: { id }, include: includeAgent }),
        prisma.training.findMany({ include: { minRank: true }, orderBy: { sortOrder: 'asc' } }),
      ])
      return success(same ? withAgentTrainingRows(same, trainings) : same)
    }

    const targetRank = await prisma.rank.findUnique({ where: { id: targetRankId } })
    if (!targetRank) return error('Ziel-Rang nicht gefunden')

    const prefix = await getBadgePrefix()
    // Exclude terminated agents so their badge numbers are free for reassignment
    const allForBadges = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
    const blacklistedBadges = await getBlacklistedBadgeRows()

    let newBadge = agent.badgeNumber
    if (rankHasBadgeRange(targetRank)) {
      const assigned = nextBadgeForRank(targetRank, allForBadges, prefix, agent.badgeNumber, blacklistedBadges)
      // Ziel-Bereich voll → Agent behält seine bisherige Dienstnummer
      if (assigned) newBadge = assigned.str
    }
    if (newBadge !== agent.badgeNumber) {
      await releaseTerminatedBadgeNumberConflicts(newBadge, prefix)
    }

    await prisma.promotionLog.create({
      data: {
        agentId: id,
        oldRankId: agent.rankId,
        newRankId: targetRankId,
        oldBadgeNumber: agent.badgeNumber,
        newBadgeNumber: newBadge,
        performedByUserId: user.id,
        note: 'Verschiebung (Roster)',
      },
    })

    const updated = await prisma.agent.update({
      where: { id },
      data: { rankId: targetRankId, badgeNumber: newBadge },
      include: includeAgent,
    })
    const trainings = await prisma.training.findMany({
      include: { minRank: true },
      orderBy: { sortOrder: 'asc' },
    })
    const updatedWithTrainingRows = withAgentTrainingRows(updated, trainings)
    await syncLinkedUserDisplayNameForAgent(updated)

    await createAuditLog({
      action: 'AGENT_PROMOTED',
      userId: user.id,
      agentId: id,
      oldValue: agent.rank.name,
      newValue: targetRank.name,
      details: `${agent.firstName} ${agent.lastName}: ${agent.badgeNumber} → ${newBadge} · ${agent.rank.name} → ${targetRank.name}`,
    })

    queueAgentRoleSync(id)
    queueDiscordHrEvent({
      type: 'promotion',
      title: `Rangänderung: ${agent.firstName} ${agent.lastName}`,
      description: 'Die Dienstgradänderung wurde im Rahmen der aktuellen Personalplanung vorgenommen.',
      agent: updatedWithTrainingRows,
      actor: user,
      fields: [
        { name: 'Alter Rang', value: agent.rank.name, inline: true },
        { name: 'Neuer Rang', value: `**${targetRank.name}**`, inline: true },
        { name: 'DN-Wechsel', value: `${agent.badgeNumber} → **${newBadge}**`, inline: true },
      ],
    })

    return success(updatedWithTrainingRows)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Discord-ID bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
