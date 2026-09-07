import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { summarizeRankChangeVotes } from '@/lib/rank-change-votes'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let currentUser
  try {
    currentUser = await requirePermission('rank-changes:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const { id } = await params
  const list = await prisma.rankChangeList.findUnique({
    where: { id },
    include: {
      createdBy: { select: { displayName: true } },
      entries: {
        include: {
          agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true, status: true } },
          currentRank: { select: { id: true, name: true, color: true, sortOrder: true } },
          proposedRank: { select: { id: true, name: true, color: true, sortOrder: true } },
          createdBy: { select: { id: true, displayName: true } },
          executedBy: { select: { id: true, displayName: true } },
          votes: { select: { userId: true, value: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!list) return error('Liste nicht gefunden', 404)
  const avatarUrls = await resolveAgentAvatarUrls(list.entries.map((entry) => entry.agent))
  return success({
    ...list,
    entries: list.entries.map((entry) => {
      const { votes, _count, ...entryWithoutVotes } = entry
      return {
        ...entryWithoutVotes,
        agent: {
          ...entry.agent,
          avatarUrl: agentAvatarUrl(entry.agent, avatarUrls),
        },
        commentCount: _count.comments,
        voteSummary: summarizeRankChangeVotes(votes, currentUser.id),
      }
    }),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const { id } = await params
    const body = await req.json()

    const { name, description, status, submissionsClosed } = body

    if (status !== undefined && !['DRAFT', 'COMPLETED'].includes(status)) return error('Ungültiger Status')
    if (submissionsClosed !== undefined && typeof submissionsClosed !== 'boolean') {
      return error('submissionsClosed muss ein Boolean sein')
    }

    const list = await prisma.rankChangeList.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(submissionsClosed !== undefined && {
          submissionsClosed,
          closedAt: submissionsClosed ? new Date() : null,
        }),
      },
    })

    return success(list)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['rank-change-lists:delete'])
    const { id } = await params

    await prisma.rankChangeList.delete({ where: { id } })
    return success({ deleted: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
