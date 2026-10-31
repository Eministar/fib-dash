import { prisma } from '@/lib/prisma'
import { error, unauthorized } from '@/lib/api-response'
import { findAgentForUser } from '@/lib/duty/manual-duty'
import { isUniqueConstraintError } from '@/lib/core/prisma-errors'
import {
  RATEABLE_STATUSES,
  aggregateRatings,
  rankScores,
  ratingRejection,
  weekKey,
  weekWinners,
  type RatingScores,
} from '@/lib/agents/agent-of-week'

export class AgentOfWeekError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** Einheitliche API-Antwort für alle Routen unter /api/agent-of-week. */
export function agentOfWeekFailure(e: unknown) {
  if (e instanceof AgentOfWeekError) return error(e.message, e.status)
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

const AGENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  badgeNumber: true,
  discordId: true,
  rank: { select: { name: true, color: true, sortOrder: true } },
} as const

const SCORE_SELECT = { shooting: true, work: true, activity: true, roleplay: true } as const

type Viewer = { id: string; discordId: string | null }

/** Live-Ranking einer Woche, mit Agent-Daten für Seite und Board. */
export async function getWeekRanking(week: string) {
  const ratings = await prisma.agentWeeklyRating.findMany({ where: { week }, select: { agentId: true, raterId: true, ...SCORE_SELECT } })
  const ranked = rankScores(aggregateRatings(ratings))
  const agents = ranked.length
    ? await prisma.agent.findMany({ where: { id: { in: ranked.map((row) => row.agentId) } }, select: AGENT_SELECT })
    : []
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  return {
    raterCount: new Set(ratings.map((row) => row.raterId)).size,
    ranking: ranked.flatMap((row) => {
      const agent = byId.get(row.agentId)
      return agent ? [{ ...row, agent }] : []
    }),
  }
}

const RESULT_SELECT = {
  week: true, agentId: true, firstName: true, lastName: true, badgeNumber: true,
  place: true, overall: true, ratingCount: true, winner: true, ...SCORE_SELECT,
} as const

/** Titelträger der zuletzt abgeschlossenen Woche, die einen Sieger hatte. */
export async function getLatestWinners() {
  const latest = await prisma.agentWeeklyResult.findFirst({ where: { winner: true }, orderBy: { week: 'desc' }, select: { week: true } })
  if (!latest) return null
  const agents = await prisma.agentWeeklyResult.findMany({
    where: { week: latest.week, winner: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { ...RESULT_SELECT, agent: { select: AGENT_SELECT } },
  })
  return { week: latest.week, agents }
}

/** Alle bisherigen Agents der Woche, neueste Woche zuerst. */
export async function getWinnerHistory(limit = 52) {
  const rows = await prisma.agentWeeklyResult.findMany({
    where: { winner: true },
    orderBy: [{ week: 'desc' }, { lastName: 'asc' }],
    take: limit,
    select: RESULT_SELECT,
  })
  const weeks = new Map<string, typeof rows>()
  for (const row of rows) weeks.set(row.week, [...(weeks.get(row.week) ?? []), row])
  return [...weeks].map(([week, agents]) => ({ week, agents }))
}

/** Stand für die Seite „Agent der Woche“. */
export async function getAgentOfWeekState(viewer: Viewer, access: { canRate: boolean; canManage: boolean }, now = new Date()) {
  const week = weekKey(now)
  const [live, winners, history, ownAgent] = await Promise.all([
    getWeekRanking(week),
    getLatestWinners(),
    getWinnerHistory(),
    access.canRate ? findAgentForUser(viewer) : Promise.resolve(null),
  ])

  const canRate = access.canRate && Boolean(ownAgent)
  const [candidates, myRatings] = canRate
    ? await Promise.all([
      prisma.agent.findMany({
        where: { status: { in: [...RATEABLE_STATUSES] }, id: { not: ownAgent!.id } },
        select: AGENT_SELECT,
        orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
      }),
      prisma.agentWeeklyRating.findMany({ where: { week, raterId: viewer.id }, select: { agentId: true, ...SCORE_SELECT } }),
    ])
    : [[], []]

  return {
    week,
    ...live,
    winners,
    history,
    canRate,
    /** Recht vorhanden, aber kein Agent verknüpft – die Seite erklärt das. */
    needsAgentLink: access.canRate && !ownAgent,
    canManage: access.canManage,
    candidates,
    myRatings,
  }
}

export async function saveAgentWeeklyRating(viewer: Viewer, agentId: string, scores: RatingScores, now = new Date()) {
  const [ownAgent, agent] = await Promise.all([
    findAgentForUser(viewer),
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, status: true } }),
  ])
  if (!agent) throw new AgentOfWeekError('Agent nicht gefunden', 404)
  const rejection = ratingRejection({ raterAgentId: ownAgent?.id ?? null, agentId, agentStatus: agent.status })
  if (rejection) throw new AgentOfWeekError(rejection, ownAgent ? 400 : 403)

  const week = weekKey(now)
  await prisma.agentWeeklyRating.upsert({
    where: { week_raterId_agentId: { week, raterId: viewer.id, agentId } },
    create: { week, raterId: viewer.id, agentId, ...scores },
    update: scores,
  })
}

/** Einzelbewertungen eines Agents in der laufenden Woche – nur für die Verwaltung. */
export async function listAgentWeeklyRatings(agentId: string, now = new Date()) {
  return prisma.agentWeeklyRating.findMany({
    where: { week: weekKey(now), agentId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, updatedAt: true, ...SCORE_SELECT, rater: { select: { id: true, displayName: true } } },
  })
}

/** Nur in der laufenden Woche – abgeschlossene Wochen sind eingefroren. */
export async function deleteAgentWeeklyRating(id: string, now = new Date()) {
  const rating = await prisma.agentWeeklyRating.findUnique({ where: { id }, select: { week: true, agentId: true } })
  if (!rating) throw new AgentOfWeekError('Bewertung nicht gefunden', 404)
  if (rating.week !== weekKey(now)) throw new AgentOfWeekError('Bewertungen abgeschlossener Wochen können nicht gelöscht werden.', 409)
  await prisma.agentWeeklyRating.delete({ where: { id } })
  return rating
}

/**
 * Friert alle vergangenen Wochen ein, die Bewertungen, aber noch kein Ergebnis
 * haben. Der eindeutige Index (Woche, Agent) verhindert doppelte Ergebnisse,
 * wenn zwei Läufe gleichzeitig abschließen. Liefert die neu geschlossenen Wochen.
 */
export async function closeFinishedWeeks(now = new Date()) {
  const current = weekKey(now)
  const [rated, closed] = await Promise.all([
    prisma.agentWeeklyRating.findMany({ where: { week: { lt: current } }, distinct: ['week'], select: { week: true } }),
    prisma.agentWeeklyResult.findMany({ distinct: ['week'], select: { week: true } }),
  ])
  const done = new Set(closed.map((row) => row.week))
  const open = rated.map((row) => row.week).filter((week) => !done.has(week)).sort()

  const closedNow: string[] = []
  for (const week of open) {
    const { ranking } = await getWeekRanking(week)
    if (!ranking.length) continue
    const winners = new Set(weekWinners(ranking).map((row) => row.agentId))
    const created = await prisma.agentWeeklyResult.createMany({
      data: ranking.map((row) => ({
        week,
        agentId: row.agentId,
        firstName: row.agent.firstName,
        lastName: row.agent.lastName,
        badgeNumber: row.agent.badgeNumber,
        place: row.place,
        overall: row.overall,
        shooting: row.shooting,
        work: row.work,
        activity: row.activity,
        roleplay: row.roleplay,
        ratingCount: row.ratingCount,
        winner: winners.has(row.agentId),
      })),
    }).catch((cause) => {
      // Ein paralleler Lauf hat die Woche schon geschlossen.
      if (isUniqueConstraintError(cause)) return null
      throw cause
    })
    if (created?.count) closedNow.push(week)
  }
  return closedNow
}

/** Abgeschlossene Wochen, in denen der Agent den Titel geholt hat. */
export async function getAgentOfWeekWins(agentId: string): Promise<string[]> {
  const rows = await prisma.agentWeeklyResult.findMany({ where: { agentId, winner: true }, orderBy: { week: 'asc' }, select: { week: true } })
  return rows.map((row) => row.week)
}
