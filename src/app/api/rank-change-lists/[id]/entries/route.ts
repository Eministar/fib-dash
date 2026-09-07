import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'
import { normalizeBadgeNumber, rankHasBadgeRange, resolveEntryBadgeNumbers } from '@/lib/badge-number'
import { findBadgeNumberConflict, getBlacklistedBadgeRows } from '@/lib/badge-blacklist'
import { rankChangeSnapshot, snapshotJson } from '@/lib/rank-change-entry'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const { id } = await params
    const body = await req.json()

    const { agentId, proposedRankId, newBadgeNumber, note } = body
    if (!agentId || !proposedRankId) return error('Agent und vorgeschlagener Rang sind erforderlich')

    const list = await prisma.rankChangeList.findUnique({ where: { id } })
    if (!list) return error('Liste nicht gefunden', 404)
    if (list.status === 'COMPLETED') return error('Liste ist bereits abgeschlossen')
    if (list.submissionsClosed) return error('Einreichungen für diese Liste sind geschlossen')

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { rank: true } })
    if (!agent) return error('Agent nicht gefunden')
    const proposedRank = await prisma.rank.findUnique({ where: { id: proposedRankId } })
    if (!proposedRank) return error('Vorgeschlagener Rang nicht gefunden')

    // Uprank-Sperre: gesperrte Agent dürfen nicht auf Beförderungslisten (Aufstieg).
    // Kleinerer sortOrder = höherer Rang = Beförderung. Degradierungen bleiben erlaubt.
    const isPromotion = proposedRank.sortOrder < agent.rank.sortOrder
    if (isPromotion && agent.promotionBlocked) {
      return error('Agent hat eine aktive Uprank-Sperre und kann nicht befördert werden.')
    }

    const existing = await prisma.rankChangeListEntry.findUnique({
      where: { listId_agentId: { listId: id, agentId } },
    })
    if (existing) return error('Agent ist bereits in dieser Liste')

    let nextBadge = typeof newBadgeNumber === 'string' ? newBadgeNumber.trim() : ''
    const prefix = await getBadgePrefix()
    if (nextBadge) nextBadge = normalizeBadgeNumber(nextBadge, prefix)
    // Auto-DN wird nicht gespeichert (newBadgeNumber bleibt null), sondern bei Anzeige und
    // Durchführung live aus dem aktuellen Stand berechnet. Hier nur validieren, dass derzeit
    // eine freie Nummer existiert, und die Vorschau für die Antwort ermitteln.
    let previewBadge: string | null = null
    if (!nextBadge && rankHasBadgeRange(proposedRank)) {
      // Exclude terminated agents so ihre Dienstnummern gelten als frei
      const allRows = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
      const blacklistedBadges = await getBlacklistedBadgeRows()
      const siblingEntries = await prisma.rankChangeListEntry.findMany({
        where: { listId: id, executed: false },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          newBadgeNumber: true,
          agent: { select: { badgeNumber: true } },
          proposedRank: { select: { badgeMin: true, badgeMax: true } },
        },
      })
      const resolved = resolveEntryBadgeNumbers(
        [...siblingEntries, { id: '__new__', newBadgeNumber: null, agent, proposedRank }],
        allRows,
        blacklistedBadges,
        prefix,
      )
      // null = keine freie Nummer auffindbar → Agent behält seine aktuelle Dienstnummer
      previewBadge = resolved.get('__new__') ?? null
    }
    if (nextBadge && nextBadge !== agent.badgeNumber) {
      const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
      const badgeConflict = await findBadgeNumberConflict(nextBadge, prefix, agentId, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
      if (badgeConflict) return error(badgeConflict)
      if (!allowDuplicateBadgeNumbers) {
        const badgeInList = await prisma.rankChangeListEntry.findFirst({
          where: {
            listId: id,
            newBadgeNumber: nextBadge,
            executed: false,
          },
        })
        if (badgeInList) return error('Dienstnummer ist bereits in dieser Liste vorgesehen')
      }
    }

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.rankChangeListEntry.create({
        data: {
          listId: id,
          agentId,
          currentRankId: agent.rankId,
          proposedRankId,
          newBadgeNumber: nextBadge || null,
          note: typeof note === 'string' && note.trim() ? note.trim() : null,
          createdById: user.id,
        },
        include: {
          agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true } },
          currentRank: { select: { id: true, name: true, color: true, sortOrder: true } },
          proposedRank: { select: { id: true, name: true, color: true, sortOrder: true } },
          createdBy: { select: { id: true, displayName: true } },
        },
      })
      await tx.rankChangeEntryHistory.create({
        data: {
          entryId: created.id,
          revision: 1,
          actorId: user.id,
          action: 'CREATED',
          beforeState: {},
          afterState: snapshotJson(rankChangeSnapshot(created)),
        },
      })
      return created
    })

    // Vorschau der Auto-DN in der Antwort mitgeben (nicht persistiert)
    return success({ ...entry, newBadgeNumber: entry.newBadgeNumber ?? previewBadge }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const { id } = await params
    const { entryId } = await req.json()

    if (!entryId) return error('Entry ID ist erforderlich')

    await prisma.rankChangeListEntry.delete({ where: { id: entryId, listId: id } })
    return success({ deleted: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
