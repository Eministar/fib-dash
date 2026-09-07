import { prisma } from './prisma'
import { parseBadgeNumberToInt } from './badge-number'

type BadgeReleaseClient = {
  agent: {
    findMany: typeof prisma.agent.findMany
    update: typeof prisma.agent.update
  }
}

function releasedBadgeNumber(badgeNumber: string, agentId: string) {
  return `${badgeNumber.trim()}__terminated__${agentId}`
}

export function sameBadgeNumber(a: string, b: string, prefix: string) {
  const aTrimmed = a.trim()
  const bTrimmed = b.trim()
  if (aTrimmed.toLowerCase() === bTrimmed.toLowerCase()) return true

  const aInt = parseBadgeNumberToInt(aTrimmed, prefix)
  const bInt = parseBadgeNumberToInt(bTrimmed, prefix)
  return aInt !== null && bInt !== null && aInt === bInt
}

export async function getBlacklistedBadgeRows() {
  return prisma.badgeBlacklist.findMany({ select: { badgeNumber: true } })
}

export async function findBlacklistedBadgeNumber(badgeNumber: string, prefix: string) {
  const normalized = badgeNumber.trim()
  if (!normalized) return null

  const blacklisted = await prisma.badgeBlacklist.findMany({ select: { badgeNumber: true } })
  return blacklisted.find((row) => sameBadgeNumber(row.badgeNumber, normalized, prefix)) ?? null
}

export async function findBadgeNumberConflict(
  badgeNumber: string,
  prefix: string,
  currentAgentId?: string | null,
  options?: { allowAgentDuplicate?: boolean },
) {
  const normalized = badgeNumber.trim()
  if (!normalized) return null

  const [agents, blacklisted] = await Promise.all([
    // Exclude terminated agents: ihre Dienstnummern gelten als frei
    prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { id: true, badgeNumber: true } }),
    prisma.badgeBlacklist.findMany({ select: { badgeNumber: true } }),
  ])

  if (!options?.allowAgentDuplicate) {
    const agent = agents.find((row) => (
      row.id !== currentAgentId && sameBadgeNumber(row.badgeNumber, normalized, prefix)
    ))
    if (agent) return 'Dienstnummer bereits vergeben'
  }

  const blocked = blacklisted.find((row) => sameBadgeNumber(row.badgeNumber, normalized, prefix))
  if (blocked) return 'Dienstnummer ist gesperrt'

  return null
}

export async function releaseTerminatedBadgeNumber(
  agent: { id: string; badgeNumber: string },
  client: BadgeReleaseClient = prisma,
) {
  await client.agent.update({
    where: { id: agent.id },
    data: { badgeNumber: releasedBadgeNumber(agent.badgeNumber, agent.id) },
  })
}

export async function releaseTerminatedBadgeNumberConflicts(
  badgeNumber: string,
  prefix: string,
  client: BadgeReleaseClient = prisma,
) {
  const normalized = badgeNumber.trim()
  if (!normalized) return

  const terminatedAgents = await client.agent.findMany({
    where: { status: 'TERMINATED' },
    select: { id: true, badgeNumber: true },
  })

  await Promise.all(
    terminatedAgents
      .filter((agent) => sameBadgeNumber(agent.badgeNumber, normalized, prefix))
      .map((agent) => releaseTerminatedBadgeNumber(agent, client)),
  )
}
