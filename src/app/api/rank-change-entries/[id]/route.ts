import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { summarizeRankChangeVotes } from '@/lib/rank-change-votes'
import {
  rankChangeEntryInclude,
  rankChangeSnapshot,
  snapshotJson,
  snapshotsEqual,
  validateRankChangeDesiredState,
} from '@/lib/rank-change-entry'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'
import { storedDiscordAvatarUrl } from '@/lib/discord-auth'

const personSelect = {
  id: true,
  displayName: true,
  discordId: true,
  discordAvatar: true,
  discordDiscriminator: true,
} as const

function publicPerson(person: {
  id: string
  displayName: string
  discordId: string | null
  discordAvatar: string | null
  discordDiscriminator: string | null
} | null) {
  return person ? {
    id: person.id,
    displayName: person.displayName,
    discordId: person.discordId,
    avatarUrl: storedDiscordAvatarUrl(person),
  } : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id } = await params
    const [entry, ranks] = await Promise.all([
      prisma.rankChangeListEntry.findUnique({
        where: { id },
        include: {
          ...rankChangeEntryInclude(),
          votes: { select: { userId: true, value: true } },
          comments: {
            include: { author: { select: personSelect } },
            orderBy: { createdAt: 'asc' },
          },
          proposals: {
            include: {
              author: { select: personSelect },
              reviewedBy: { select: personSelect },
            },
            orderBy: { createdAt: 'desc' },
          },
          history: {
            include: { actor: { select: personSelect } },
            orderBy: { revision: 'desc' },
          },
        },
      }),
      prisma.rank.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, color: true, sortOrder: true },
      }),
    ])
    if (!entry) return error('Rangänderung nicht gefunden', 404)

    const elevated = hasPermission(user, 'rank-changes:full-access')
    const isCreator = entry.createdById === user.id
    const mutable = !entry.executed && entry.list.status !== 'COMPLETED'
    const avatarUrls = await resolveAgentAvatarUrls([entry.agent])

    return success({
      entry: {
        ...entry,
        agent: {
          ...entry.agent,
          avatarUrl: agentAvatarUrl(entry.agent, avatarUrls),
        },
        createdBy: publicPerson(entry.createdBy),
        executedBy: publicPerson(entry.executedBy),
        votes: undefined,
        comments: entry.comments.map((comment) => ({
          ...comment,
          author: publicPerson(comment.author),
        })),
        voteSummary: summarizeRankChangeVotes(entry.votes, user.id),
        proposals: entry.proposals.map((proposal) => ({
          ...proposal,
          author: publicPerson(proposal.author),
          reviewedBy: publicPerson(proposal.reviewedBy),
          isStale: proposal.baseRevision !== entry.revision,
        })),
        history: entry.history.map((record) => ({
          ...record,
          actor: publicPerson(record.actor),
        })),
      },
      ranks,
      currentUserId: user.id,
      permissions: {
        canEdit: mutable && (isCreator || elevated),
        canSuggest: mutable && !isCreator && !elevated,
        canReview: mutable && (isCreator || elevated),
        canComment: true,
        canModerateComments: elevated,
      },
    })
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(undefined, ['rank-changes:view'])
    const { id } = await params
    const body = await req.json()
    const entry = await prisma.rankChangeListEntry.findUnique({
      where: { id },
      include: rankChangeEntryInclude(),
    })
    if (!entry) return error('Rangänderung nicht gefunden', 404)

    const elevated = hasPermission(user, 'rank-changes:full-access')
    if (entry.createdById !== user.id && !elevated) return error('Du kannst diesen Eintrag nur als Änderung vorschlagen', 403)
    if (entry.executed || entry.list.status === 'COMPLETED') return error('Dieser Eintrag kann nicht mehr bearbeitet werden', 409)

    const before = rankChangeSnapshot(entry)
    const after = await validateRankChangeDesiredState(entry, body)
    if (snapshotsEqual(before, after)) return error('Es wurden keine Änderungen vorgenommen')
    const revision = entry.revision + 1

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.rankChangeListEntry.update({
        where: { id: entry.id, revision: entry.revision },
        data: {
          proposedRankId: after.proposedRank.id,
          newBadgeNumber: after.newBadgeNumber,
          note: after.note,
          revision,
        },
        include: rankChangeEntryInclude(),
      })
      await tx.rankChangeEntryHistory.create({
        data: {
          entryId: entry.id,
          revision,
          actorId: user.id,
          action: 'DIRECT_EDIT',
          beforeState: snapshotJson(before),
          afterState: snapshotJson(after),
        },
      })
      await tx.auditLog.create({
        data: {
          action: 'RANK_CHANGE_ENTRY_UPDATED',
          userId: user.id,
          agentId: entry.agentId,
          oldValue: before.proposedRank.name,
          newValue: after.proposedRank.name,
          details: `Rangänderung in „${entry.list.name}“ bearbeitet`,
        },
      })
      return changed
    })

    return success(updated)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    if (message.includes('Record to update not found')) return error('Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.', 409)
    return error(message, message.includes('nicht gefunden') ? 404 : 400)
  }
}
