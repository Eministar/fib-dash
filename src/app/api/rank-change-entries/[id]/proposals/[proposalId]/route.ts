import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import {
  rankChangeEntryInclude,
  rankChangeSnapshot,
  snapshotJson,
  validateRankChangeDesiredState,
  type RankChangeEntrySnapshot,
} from '@/lib/rank-change-entry'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> },
) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id, proposalId } = await params
    const body = await req.json()
    const action = body.action === 'ACCEPT' || body.action === 'REJECT' ? body.action : null
    if (!action) return error('Aktion muss ACCEPT oder REJECT sein')
    const reviewNote = typeof body.reviewNote === 'string' ? body.reviewNote.trim() : ''
    if (reviewNote.length > 2_000) return error('Prüfnotiz darf höchstens 2.000 Zeichen enthalten')

    const proposal = await prisma.rankChangeEntryProposal.findFirst({
      where: { id: proposalId, entryId: id },
      include: { entry: { include: rankChangeEntryInclude() } },
    })
    if (!proposal) return error('Änderungsvorschlag nicht gefunden', 404)
    const entry = proposal.entry
    const elevated = hasPermission(user, 'rank-changes:full-access')
    if (entry.createdById !== user.id && !elevated) return error('Keine Berechtigung', 403)
    if (proposal.status !== 'PENDING') return error('Dieser Vorschlag wurde bereits geprüft', 409)

    if (action === 'REJECT') {
      const rejected = await prisma.$transaction(async (tx) => {
        const updated = await tx.rankChangeEntryProposal.update({
          where: { id: proposal.id },
          data: {
            status: 'REJECTED',
            reviewedById: user.id,
            reviewedAt: new Date(),
            reviewNote: reviewNote || null,
          },
        })
        await tx.auditLog.create({
          data: {
            action: 'RANK_CHANGE_PROPOSAL_REJECTED',
            userId: user.id,
            agentId: entry.agentId,
            details: `Änderungsvorschlag für „${entry.list.name}“ abgelehnt`,
          },
        })
        return updated
      })
      return success(rejected)
    }

    if (entry.executed || entry.list.status === 'COMPLETED') return error('Dieser Eintrag kann nicht mehr geändert werden', 409)
    if (proposal.baseRevision !== entry.revision) {
      return error('Der Eintrag wurde seit diesem Vorschlag geändert. Der Vorschlag ist veraltet.', 409)
    }

    const storedAfter = proposal.afterState as unknown as RankChangeEntrySnapshot
    const before = rankChangeSnapshot(entry)
    const after = await validateRankChangeDesiredState(entry, {
      proposedRankId: storedAfter?.proposedRank?.id,
      newBadgeNumber: storedAfter?.newBadgeNumber,
      note: storedAfter?.note,
    })
    const revision = entry.revision + 1

    const accepted = await prisma.$transaction(async (tx) => {
      const changedEntry = await tx.rankChangeListEntry.update({
        where: { id: entry.id, revision: entry.revision },
        data: {
          proposedRankId: after.proposedRank.id,
          newBadgeNumber: after.newBadgeNumber,
          note: after.note,
          revision,
        },
      })
      const updatedProposal = await tx.rankChangeEntryProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'ACCEPTED',
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: reviewNote || null,
        },
      })
      await tx.rankChangeEntryHistory.create({
        data: {
          entryId: entry.id,
          revision,
          actorId: user.id,
          action: 'PROPOSAL_ACCEPTED',
          beforeState: snapshotJson(before),
          afterState: snapshotJson(after),
          proposalId: proposal.id,
        },
      })
      await tx.auditLog.create({
        data: {
          action: 'RANK_CHANGE_PROPOSAL_ACCEPTED',
          userId: user.id,
          agentId: entry.agentId,
          oldValue: before.proposedRank.name,
          newValue: after.proposedRank.name,
          details: `Änderungsvorschlag für „${entry.list.name}“ angenommen`,
        },
      })
      return { entry: changedEntry, proposal: updatedProposal }
    })

    return success(accepted)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    if (message.includes('Record to update not found')) return error('Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.', 409)
    return error(message, message.includes('nicht gefunden') ? 404 : 400)
  }
}
