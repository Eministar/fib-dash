import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import {
  rankChangeEntryInclude,
  rankChangeSnapshot,
  snapshotJson,
  snapshotsEqual,
  validateRankChangeDesiredState,
} from '@/lib/rank-change-entry'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id } = await params
    const body = await req.json()
    const entry = await prisma.rankChangeListEntry.findUnique({
      where: { id },
      include: rankChangeEntryInclude(),
    })
    if (!entry) return error('Rangänderung nicht gefunden', 404)
    if (entry.createdById === user.id || hasPermission(user, 'rank-changes:full-access')) {
      return error('Du kannst diesen Eintrag direkt bearbeiten', 403)
    }
    if (entry.executed || entry.list.status === 'COMPLETED') {
      return error('Für diesen Eintrag können keine Änderungen mehr vorgeschlagen werden', 409)
    }

    const before = rankChangeSnapshot(entry)
    const after = await validateRankChangeDesiredState(entry, body)
    if (snapshotsEqual(before, after)) return error('Der Vorschlag enthält keine Änderung')
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length > 2_000) return error('Begründung darf höchstens 2.000 Zeichen enthalten')

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.rankChangeEntryProposal.create({
        data: {
          entryId: entry.id,
          authorId: user.id,
          baseRevision: entry.revision,
          beforeState: snapshotJson(before),
          afterState: snapshotJson(after),
          reason: reason || null,
        },
        include: { author: { select: { id: true, displayName: true, discordId: true } } },
      })
      await tx.auditLog.create({
        data: {
          action: 'RANK_CHANGE_PROPOSAL_CREATED',
          userId: user.id,
          agentId: entry.agentId,
          oldValue: before.proposedRank.name,
          newValue: after.proposedRank.name,
          details: `Änderung für „${entry.list.name}“ vorgeschlagen`,
        },
      })
      return created
    })

    return success({ ...proposal, isStale: false }, 201)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, message.includes('nicht gefunden') ? 404 : 400)
  }
}
