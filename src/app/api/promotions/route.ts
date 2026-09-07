import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'
import { nextBadgeForRank, normalizeBadgeNumber, rankHasBadgeRange } from '@/lib/badge-number'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { findBadgeNumberConflict, getBlacklistedBadgeRows, releaseTerminatedBadgeNumberConflicts } from '@/lib/badge-blacklist'
import { queueDiscordHrEvent, queueAgentRoleSync } from '@/lib/discord-integration'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'

export async function GET() {
  try {
    await requirePermission('rank-changes:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const promotions = await prisma.promotionLog.findMany({
    include: {
      agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
      oldRank: true,
      newRank: true,
      performedBy: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return success(promotions)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const body = await req.json()

    const { agentId, newRankId, newBadgeNumber: bodyBadge, note } = body
    if (!agentId || !newRankId) return error('Agent und neuer Rang sind erforderlich')

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { rank: true } })
    if (!agent) return error('Agent nicht gefunden')

    const newRank = await prisma.rank.findUnique({ where: { id: newRankId } })
    if (!newRank) return error('Rang nicht gefunden')

    // Uprank-Sperre: gesperrte Agent können nicht befördert werden (Aufstieg =
    // kleinerer sortOrder). Degradierungen bleiben erlaubt.
    if (newRank.sortOrder < agent.rank.sortOrder && agent.promotionBlocked) {
      return error('Agent hat eine aktive Uprank-Sperre und kann nicht befördert werden.')
    }

    let newBadgeNumber: string = typeof bodyBadge === 'string' && bodyBadge.trim() ? bodyBadge.trim() : ''
    const prefix = await getBadgePrefix()
    if (newBadgeNumber) newBadgeNumber = normalizeBadgeNumber(newBadgeNumber, prefix)

    if (!newBadgeNumber) {
      if (rankHasBadgeRange(newRank)) {
        // Exclude terminated agents so ihre Dienstnummern gelten als frei
        const allRows = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
        const blacklistedBadges = await getBlacklistedBadgeRows()
        const assigned = nextBadgeForRank(newRank, allRows, prefix, agent.badgeNumber, blacklistedBadges)
        if (!assigned) {
          // Fallback: wenn kein freier Wert im Ziel-Rang gefunden wurde, behalten wir
          // die aktuelle Dienstnummer bei statt die Operation mit 400 abzubrechen.
          // Dadurch funktioniert Beförderung auch dann, wenn Bereiche falsch
          // konfiguriert sind oder temporär keine freie Nummer vorhanden ist.
          // Ein möglicher Konflikt wird später durch findBadgeNumberConflict erkannt.
          newBadgeNumber = agent.badgeNumber
        } else {
          newBadgeNumber = assigned.str
        }
      } else {
        newBadgeNumber = agent.badgeNumber
      }
    }

    if (newBadgeNumber && newBadgeNumber !== agent.badgeNumber) {
      const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
      const badgeConflict = await findBadgeNumberConflict(newBadgeNumber, prefix, agentId, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
      if (badgeConflict) return error(badgeConflict)
      await releaseTerminatedBadgeNumberConflicts(newBadgeNumber, prefix)
    }

    const promotion = await prisma.promotionLog.create({
      data: {
        agentId,
        oldRankId: agent.rankId,
        newRankId,
        oldBadgeNumber: agent.badgeNumber,
        newBadgeNumber: newBadgeNumber || agent.badgeNumber,
        performedByUserId: user.id,
        note: note || null,
      },
    })

    const updatedAgent = await prisma.agent.update({
      where: { id: agentId },
      data: {
        rankId: newRankId,
        badgeNumber: newBadgeNumber || agent.badgeNumber,
      },
      include: { rank: true },
    })
    await syncLinkedUserDisplayNameForAgent(updatedAgent)

    await createAuditLog({
      action: 'AGENT_PROMOTED',
      userId: user.id,
      agentId,
      oldValue: agent.rank.name,
      newValue: newRank.name,
      details: `${agent.firstName} ${agent.lastName}: ${agent.rank.name} → ${newRank.name}`,
    })

    queueAgentRoleSync(agentId)
    queueDiscordHrEvent({
      type: 'promotion',
      title: `Rangänderung: ${agent.firstName} ${agent.lastName}`,
      description: note ? `**Anmerkung:** ${note}` : undefined,
      agent: updatedAgent,
      actor: user,
      fields: [
        { name: 'Alter Rang', value: agent.rank.name, inline: true },
        { name: 'Neuer Rang', value: `**${newRank.name}**`, inline: true },
        { name: 'DN-Wechsel', value: `${agent.badgeNumber} → **${newBadgeNumber || agent.badgeNumber}**`, inline: true },
      ],
    })

    return success(promotion, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Discord-ID bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
