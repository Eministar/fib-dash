import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { isRankChangeVoteValue, summarizeRankChangeVotes } from '@/lib/rank-change-votes'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const user = await requirePermission('rank-changes:view')
    const { id, entryId } = await params
    const body: unknown = await req.json()
    const vote = typeof body === 'object' && body !== null && 'vote' in body ? body.vote : undefined

    if (vote !== null && !isRankChangeVoteValue(vote)) {
      return error('Stimme muss HIGHER, CONFIRM, LOWER oder null sein')
    }

    const entry = await prisma.rankChangeListEntry.findFirst({
      where: { id: entryId, listId: id },
      select: {
        executed: true,
        list: { select: { status: true } },
      },
    })

    if (!entry) return error('Eintrag nicht gefunden', 404)
    if (entry.executed || entry.list.status === 'COMPLETED') {
      return error('Für abgeschlossene Rangänderungen kann nicht mehr abgestimmt werden')
    }

    if (vote === null) {
      await prisma.rankChangeVote.deleteMany({ where: { entryId, userId: user.id } })
    } else {
      await prisma.rankChangeVote.upsert({
        where: { entryId_userId: { entryId, userId: user.id } },
        update: { value: vote },
        create: { entryId, userId: user.id, value: vote },
      })
    }

    const votes = await prisma.rankChangeVote.findMany({
      where: { entryId },
      select: { userId: true, value: true },
    })

    return success(summarizeRankChangeVotes(votes, user.id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
