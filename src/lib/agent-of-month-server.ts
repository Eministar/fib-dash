import { prisma } from '@/lib/prisma'
import { findAgentForUser } from '@/lib/manual-duty'
import { monthKey, monthWinners, shiftMonthKey, voteRejection, type VoteTally } from '@/lib/agent-of-month'

export class AgentOfMonthError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const AGENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  badgeNumber: true,
  discordId: true,
  rank: { select: { name: true, color: true, sortOrder: true } },
} as const

async function tallyFor(month: string): Promise<VoteTally[]> {
  const rows = await prisma.agentOfMonthVote.groupBy({ by: ['agentId'], where: { month }, _count: { _all: true } })
  return rows.map((row) => ({ agentId: row.agentId, votes: row._count._all }))
}

/** Stand für die Dashboard-Karte: Sieger des Vormonats, eigene Stimme, Auswahl. */
export async function getAgentOfMonthState(user: { id: string; discordId: string | null }, now = new Date()) {
  const month = monthKey(now)
  const previousMonth = shiftMonthKey(month, -1)
  const [ownAgent, previousTally, myVote, voteCount, candidates] = await Promise.all([
    findAgentForUser(user),
    tallyFor(previousMonth),
    prisma.agentOfMonthVote.findUnique({ where: { month_voterId: { month, voterId: user.id } }, select: { agentId: true } }),
    prisma.agentOfMonthVote.count({ where: { month } }),
    prisma.agent.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: AGENT_SELECT,
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    }),
  ])

  const winnerRows = monthWinners(previousTally)
  const winnerAgents = winnerRows.length
    ? await prisma.agent.findMany({ where: { id: { in: winnerRows.map((row) => row.agentId) } }, select: AGENT_SELECT })
    : []

  return {
    month,
    previousMonth,
    winners: winnerRows.flatMap((row) => {
      const agent = winnerAgents.find((item) => item.id === row.agentId)
      return agent ? [{ ...agent, votes: row.votes }] : []
    }),
    canVote: Boolean(ownAgent),
    myVoteAgentId: myVote?.agentId ?? null,
    voteCount,
    candidates: candidates.filter((agent) => agent.id !== ownAgent?.id),
  }
}

export async function castAgentOfMonthVote(user: { id: string; discordId: string | null }, agentId: string, now = new Date()) {
  const [ownAgent, nominee] = await Promise.all([
    findAgentForUser(user),
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, status: true } }),
  ])
  if (!nominee) throw new AgentOfMonthError('Agent nicht gefunden', 404)
  const rejection = voteRejection({ voterAgentId: ownAgent?.id ?? null, nomineeAgentId: agentId, nomineeActive: nominee.status !== 'TERMINATED' })
  if (rejection) throw new AgentOfMonthError(rejection, ownAgent ? 400 : 403)

  const month = monthKey(now)
  await prisma.agentOfMonthVote.upsert({
    where: { month_voterId: { month, voterId: user.id } },
    create: { month, voterId: user.id, agentId },
    update: { agentId },
  })
}

export async function withdrawAgentOfMonthVote(userId: string, now = new Date()) {
  await prisma.agentOfMonthVote.deleteMany({ where: { month: monthKey(now), voterId: userId } })
}

/** Abgeschlossene Monate, die der Agent gewonnen hat (auch geteilte Siege). */
export async function getAgentOfMonthWins(agentId: string, now = new Date()): Promise<string[]> {
  const current = monthKey(now)
  const months = await prisma.agentOfMonthVote.findMany({
    where: { agentId, month: { lt: current } },
    distinct: ['month'],
    select: { month: true },
  })
  if (months.length === 0) return []
  const rows = await prisma.agentOfMonthVote.groupBy({
    by: ['month', 'agentId'],
    where: { month: { in: months.map((row) => row.month) } },
    _count: { _all: true },
  })
  return months
    .map((row) => row.month)
    .filter((month) => monthWinners(
      rows.filter((item) => item.month === month).map((item) => ({ agentId: item.agentId, votes: item._count._all })),
    ).some((winner) => winner.agentId === agentId))
}
