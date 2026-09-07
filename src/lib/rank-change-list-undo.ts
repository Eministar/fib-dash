import { prisma } from './prisma'
import type { CurrentUser } from './auth'
import { createAuditLog } from './audit'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from './settings-helpers'
import { findBadgeNumberConflict, releaseTerminatedBadgeNumberConflicts, sameBadgeNumber } from './badge-blacklist'
import { normalizeBadgeNumber } from './badge-number'
import { queueDiscordHrEvent, queueAgentRoleSync } from './discord-integration'
import { syncLinkedUserDisplayNameForAgent } from './user-display-name'

export type UndoPromotionListEntryData = {
  reverted: true
  agentId: string
  rankId: string
  badgeNumber: string
}

type UndoPromotionListEntryResult =
  | { ok: true; data: UndoPromotionListEntryData }
  | { ok: false; message: string; status?: number }

export async function undoPromotionListEntry(
  listId: string,
  entryId: string,
  user: Pick<CurrentUser, 'id' | 'displayName' | 'discordId'>,
): Promise<UndoPromotionListEntryResult> {
  const entry = await prisma.rankChangeListEntry.findFirst({
    where: { id: entryId, listId },
    include: {
      list: true,
      agent: true,
      currentRank: true,
      proposedRank: true,
    },
  })

  if (!entry) return { ok: false, message: 'Eintrag nicht gefunden', status: 404 }
  // Listen sind gemischt, deshalb zählt die Richtung des Eintrags:
  // kleinerer sortOrder = höherer Rang = Beförderung.
  if (entry.proposedRank.sortOrder >= entry.currentRank.sortOrder) {
    return { ok: false, message: 'Nur Beförderungen können hier rückgängig gemacht werden' }
  }
  if (!entry.executed) return { ok: false, message: 'Eintrag wurde noch nicht durchgeführt' }
  if (entry.agent.status === 'TERMINATED') {
    return { ok: false, message: 'Gekündigte Agents können nicht automatisch zurückgesetzt werden' }
  }
  if (entry.agent.rankId !== entry.proposedRankId) {
    return {
      ok: false,
      message: 'Agent hat inzwischen einen anderen Rang. Bitte manuell prüfen, bevor die Beförderung rückgängig gemacht wird',
    }
  }

  const executedUntil = entry.executedAt ? new Date(entry.executedAt.getTime() + 60_000) : undefined
  const promotionLog = await prisma.promotionLog.findFirst({
    where: {
      agentId: entry.agentId,
      oldRankId: entry.currentRankId,
      newRankId: entry.proposedRankId,
      createdAt: entry.executedAt ? { gte: entry.createdAt, lte: executedUntil } : { gte: entry.createdAt },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!promotionLog?.oldBadgeNumber) {
    return {
      ok: false,
      message: 'Passender Beförderungs-Log wurde nicht gefunden. Rücknahme abgebrochen, damit keine falsche Dienstnummer gesetzt wird',
    }
  }

  const prefix = await getBadgePrefix()
  const restoreBadgeNumber = normalizeBadgeNumber(promotionLog.oldBadgeNumber, prefix)
  const expectedCurrentBadgeNumber = promotionLog.newBadgeNumber?.trim()

  if (
    expectedCurrentBadgeNumber &&
    !sameBadgeNumber(entry.agent.badgeNumber, expectedCurrentBadgeNumber, prefix)
  ) {
    return {
      ok: false,
      message: 'Dienstnummer wurde nach der Beförderung erneut geändert. Bitte manuell prüfen, bevor die Beförderung rückgängig gemacht wird',
    }
  }

  if (!sameBadgeNumber(entry.agent.badgeNumber, restoreBadgeNumber, prefix)) {
    const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
    const badgeConflict = await findBadgeNumberConflict(restoreBadgeNumber, prefix, entry.agentId, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
    if (badgeConflict) return { ok: false, message: `${badgeConflict}: ${restoreBadgeNumber}` }
    await releaseTerminatedBadgeNumberConflicts(restoreBadgeNumber, prefix)
  }

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: entry.agentId },
      data: {
        rankId: entry.currentRankId,
        badgeNumber: restoreBadgeNumber,
      },
    })

    await tx.rankChangeListEntry.update({
      where: { id: entry.id },
      data: {
        executed: false,
        executedAt: null,
        executedById: null,
      },
    })

    await tx.rankChangeList.update({
      where: { id: entry.listId },
      data: { status: 'DRAFT' },
    })
  })

  await createAuditLog({
    action: 'AGENT_PROMOTION_REVERTED',
    userId: user.id,
    agentId: entry.agentId,
    oldValue: entry.proposedRank.name,
    newValue: entry.currentRank.name,
    details: `Beförderung aus "${entry.list.name}" rückgängig gemacht: ${entry.agent.firstName} ${entry.agent.lastName} - ${entry.proposedRank.name} -> ${entry.currentRank.name}`,
  })

  await syncLinkedUserDisplayNameForAgent({
    ...entry.agent,
    badgeNumber: restoreBadgeNumber,
  })
  queueAgentRoleSync(entry.agentId)
  queueDiscordHrEvent({
    type: 'update',
    title: `Beförderung rückgängig: ${entry.agent.firstName} ${entry.agent.lastName}`,
    description: `Die zuvor im Rahmen der Liste **${entry.list.name}** vorgenommene Beförderung wurde zurückgenommen.`,
    agent: {
      ...entry.agent,
      badgeNumber: restoreBadgeNumber,
      rankId: entry.currentRankId,
      rank: entry.currentRank,
    },
    actor: user,
    fields: [
      { name: 'Zurückgesetzt von', value: entry.proposedRank.name, inline: true },
      { name: 'Zurückgesetzt auf', value: `**${entry.currentRank.name}**`, inline: true },
      { name: 'DN-Wechsel', value: `${entry.agent.badgeNumber} -> **${restoreBadgeNumber}**`, inline: true },
    ],
  })

  return {
    ok: true,
    data: {
      reverted: true,
      agentId: entry.agentId,
      rankId: entry.currentRankId,
      badgeNumber: restoreBadgeNumber,
    },
  }
}
