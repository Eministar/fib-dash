import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { resolveEntryBadgeNumbers } from '@/lib/badge-number'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { getBlacklistedBadgeRows } from '@/lib/badge-blacklist'
import { summarizeRankChangeVotes } from '@/lib/rank-change-votes'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'

export async function GET(req: NextRequest) {
  let currentUser
  try {
    currentUser = await requirePermission('rank-changes:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const type = req.nextUrl.searchParams.get('type') || undefined

  // Gemischte Listen enthalten beide Richtungen und werden deshalb bei jedem Typfilter
  // mitgeliefert, damit ältere API-Konsumenten mit ?type=... nichts verpassen.
  const lists = await prisma.rankChangeList.findMany({
    where: type ? { type: { in: [type, 'MIXED'] } } : undefined,
    include: {
      createdBy: { select: { displayName: true } },
      entries: {
        include: {
          agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true } },
          currentRank: { select: { id: true, name: true, color: true, sortOrder: true } },
          proposedRank: { select: { id: true, name: true, color: true, sortOrder: true, badgeMin: true, badgeMax: true } },
          createdBy: { select: { id: true, displayName: true } },
          executedBy: { select: { id: true, displayName: true } },
          votes: { select: { userId: true, value: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Auto-DNs (newBadgeNumber = null) werden nicht gespeichert, sondern hier live aus dem
  // aktuellen Stand berechnet, damit sich die Vorschau an DN-Änderungen anpasst.
  if (lists.some((list) => list.entries.some((entry) => !entry.executed && !entry.newBadgeNumber))) {
    const prefix = await getBadgePrefix()
    const allRows = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
    const blacklistedBadges = await getBlacklistedBadgeRows()
    for (const list of lists) {
      const openEntries = list.entries.filter((entry) => !entry.executed)
      if (!openEntries.some((entry) => !entry.newBadgeNumber)) continue
      const resolved = resolveEntryBadgeNumbers(openEntries, allRows, blacklistedBadges, prefix)
      for (const entry of openEntries) {
        if (!entry.newBadgeNumber) entry.newBadgeNumber = resolved.get(entry.id) ?? null
      }
    }
  }

  const avatarUrls = await resolveAgentAvatarUrls(lists.flatMap((list) => list.entries.map((entry) => entry.agent)))
  const listsWithVoteSummaries = lists.map((list) => ({
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
  }))

  return success(listsWithVoteSummaries)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-changes:manage'])
    const body = await req.json()

    const { name, description, type } = body
    if (!name?.trim()) return error('Name ist erforderlich')
    // Up- und D-Ranks laufen über dieselbe Liste. `type` wird nur noch für Altbestände
    // akzeptiert; die Richtung ergibt sich pro Eintrag aus dem Rangvergleich.
    if (type && !['PROMOTION', 'DEMOTION', 'MIXED'].includes(type)) return error('Ungültiger Typ')

    const list = await prisma.rankChangeList.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type: type || 'MIXED',
        createdById: user.id,
      },
      include: {
        createdBy: { select: { displayName: true } },
        entries: true,
      },
    })

    return success(list, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
