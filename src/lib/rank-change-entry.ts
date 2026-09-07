import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeBadgeNumber } from '@/lib/badge-number'
import { findBadgeNumberConflict } from '@/lib/badge-blacklist'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'

export type RankChangeEntrySnapshot = {
  proposedRank: {
    id: string
    name: string
    color: string
    sortOrder: number
  }
  newBadgeNumber: string | null
  note: string | null
}

type EditableEntry = {
  id: string
  listId: string
  agentId: string
  newBadgeNumber: string | null
  note: string | null
  agent: {
    badgeNumber: string
    promotionBlocked: boolean
    rank: { sortOrder: number }
  }
  proposedRank: {
    id: string
    name: string
    color: string
    sortOrder: number
  }
}

export function rankChangeSnapshot(entry: Pick<EditableEntry, 'newBadgeNumber' | 'note' | 'proposedRank'>): RankChangeEntrySnapshot {
  return {
    proposedRank: {
      id: entry.proposedRank.id,
      name: entry.proposedRank.name,
      color: entry.proposedRank.color,
      sortOrder: entry.proposedRank.sortOrder,
    },
    newBadgeNumber: entry.newBadgeNumber,
    note: entry.note,
  }
}

export function snapshotsEqual(a: RankChangeEntrySnapshot, b: RankChangeEntrySnapshot) {
  return a.proposedRank.id === b.proposedRank.id
    && a.newBadgeNumber === b.newBadgeNumber
    && a.note === b.note
}

export function snapshotJson(snapshot: RankChangeEntrySnapshot): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue
}

export async function validateRankChangeDesiredState(
  entry: EditableEntry,
  input: { proposedRankId?: unknown; newBadgeNumber?: unknown; note?: unknown },
): Promise<RankChangeEntrySnapshot> {
  const proposedRankId = typeof input.proposedRankId === 'string' && input.proposedRankId
    ? input.proposedRankId
    : entry.proposedRank.id
  const proposedRank = proposedRankId === entry.proposedRank.id
    ? entry.proposedRank
    : await prisma.rank.findUnique({
        where: { id: proposedRankId },
        select: { id: true, name: true, color: true, sortOrder: true },
      })

  if (!proposedRank) throw new Error('Vorgeschlagener Rang nicht gefunden')
  if (proposedRank.sortOrder < entry.agent.rank.sortOrder && entry.agent.promotionBlocked) {
    throw new Error('Agent hat eine aktive Uprank-Sperre und kann nicht befördert werden.')
  }

  const rawBadge = input.newBadgeNumber === undefined ? entry.newBadgeNumber : input.newBadgeNumber
  let nextBadge = typeof rawBadge === 'string' ? rawBadge.trim() : ''
  const prefix = await getBadgePrefix()
  if (nextBadge) nextBadge = normalizeBadgeNumber(nextBadge, prefix)

  if (nextBadge && nextBadge !== entry.agent.badgeNumber) {
    const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
    const badgeConflict = await findBadgeNumberConflict(nextBadge, prefix, entry.agentId, {
      allowAgentDuplicate: allowDuplicateBadgeNumbers,
    })
    if (badgeConflict) throw new Error(badgeConflict)
    if (!allowDuplicateBadgeNumbers) {
      const badgeInList = await prisma.rankChangeListEntry.findFirst({
        where: {
          listId: entry.listId,
          id: { not: entry.id },
          newBadgeNumber: nextBadge,
          executed: false,
        },
        select: { id: true },
      })
      if (badgeInList) throw new Error('Dienstnummer ist bereits in dieser Liste vorgesehen')
    }
  }

  const rawNote = input.note === undefined ? entry.note : input.note
  const note = typeof rawNote === 'string' ? rawNote.trim() : ''
  if (note.length > 5_000) throw new Error('Begründung darf höchstens 5.000 Zeichen enthalten')

  return {
    proposedRank,
    newBadgeNumber: nextBadge || null,
    note: note || null,
  }
}

export function rankChangeEntryInclude() {
  return {
    list: {
      select: {
        id: true,
        name: true,
        status: true,
        submissionsClosed: true,
        createdAt: true,
      },
    },
    agent: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        promotionBlocked: true,
        rank: { select: { id: true, name: true, color: true, sortOrder: true } },
      },
    },
    currentRank: { select: { id: true, name: true, color: true, sortOrder: true } },
    proposedRank: { select: { id: true, name: true, color: true, sortOrder: true } },
    createdBy: { select: { id: true, displayName: true, discordId: true, discordAvatar: true, discordDiscriminator: true } },
    executedBy: { select: { id: true, displayName: true, discordId: true, discordAvatar: true, discordDiscriminator: true } },
  } as const
}
