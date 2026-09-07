import { prisma } from './prisma'
import { getDiscordConfig, managedDiscordRoleIds, queueAllAgentRoleSync } from './discord-integration'

export function normalizeRankIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
}

export function normalizeDiscordRoleId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && /^\d{17,22}$/.test(trimmed) ? trimmed : null
}

/**
 * Ränge, die bereits einer ANDEREN Ebene zugeordnet sind (ein Rang = genau eine
 * Ebene). Für Validierung beim Anlegen/Aktualisieren.
 */
export async function conflictingRankAssignments(rankIds: string[], excludeTierId?: string) {
  if (rankIds.length === 0) return []
  return prisma.tierRank.findMany({
    where: {
      rankId: { in: rankIds },
      ...(excludeTierId ? { tierId: { not: excludeTierId } } : {}),
    },
    select: { rank: { select: { name: true } }, tier: { select: { name: true } } },
  })
}

/**
 * Löst nach einer Ebenen-Änderung den bestehenden Agent-Rollensync aus und
 * räumt dabei Rollen auf, die durch die Änderung nicht mehr gemanaged werden.
 * `previousManaged` ist das Ergebnis von managedDiscordRoleIds VOR der Änderung.
 */
export async function queueSyncAfterTierChange(previousManaged: string[]) {
  const nextConfig = await getDiscordConfig()
  const nextManaged = new Set(managedDiscordRoleIds(nextConfig))
  const staleManaged = previousManaged.filter((roleId) => !nextManaged.has(roleId))
  queueAllAgentRoleSync({ extraManagedRoleIds: staleManaged })
}

export async function currentManagedRoleIds() {
  return managedDiscordRoleIds(await getDiscordConfig())
}

export function serializeTier(tier: {
  id: string
  name: string
  discordRoleId: string | null
  sortOrder: number
  ranks: { rankId: string }[]
}) {
  return {
    id: tier.id,
    name: tier.name,
    discordRoleId: tier.discordRoleId,
    sortOrder: tier.sortOrder,
    rankIds: tier.ranks.map((r) => r.rankId),
  }
}
