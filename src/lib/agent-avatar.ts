import { prisma } from '@/lib/prisma'
import { discordAvatarUrl, storedDiscordAvatarUrl } from '@/lib/discord-auth'
import { getDiscordGuildMembers } from '@/lib/discord-integration'

type AgentDiscordLink = { discordId?: string | null }

/**
 * Liefert für verknüpfte Agents das aktuelle Discord-Profilbild. Der Guild-
 * Member ist die bevorzugte Quelle; gespeicherte Login-Daten und schließlich
 * Discords Standardavatar dienen als robuste Fallbacks.
 */
export async function resolveAgentAvatarUrls(agents: readonly AgentDiscordLink[]) {
  const discordIds = Array.from(new Set(
    agents
      .map((agent) => agent.discordId?.trim() ?? '')
      .filter((id) => /^\d{17,22}$/.test(id)),
  ))
  const result = new Map<string, string>()
  if (discordIds.length === 0) return result

  const [users, members] = await Promise.all([
    prisma.user.findMany({
      where: { discordId: { in: discordIds } },
      select: {
        discordId: true,
        discordAvatar: true,
        discordDiscriminator: true,
      },
    }),
    getDiscordGuildMembers().catch(() => []),
  ])

  for (const user of users) {
    if (!user.discordId) continue
    const url = storedDiscordAvatarUrl(user)
    if (url) result.set(user.discordId, url)
  }

  for (const member of members) {
    const discordId = member.user?.id
    if (!discordId || !discordIds.includes(discordId) || !member.user) continue
    result.set(discordId, discordAvatarUrl(member.user))
  }

  // Auch ohne gespeichertes Login/Guild-Member niemals auf Initialen fallen:
  // aus der Discord-ID lässt sich der offizielle Standardavatar bestimmen.
  for (const discordId of discordIds) {
    if (!result.has(discordId)) {
      const url = storedDiscordAvatarUrl({ discordId })
      if (url) result.set(discordId, url)
    }
  }

  return result
}

export function agentAvatarUrl(
  agent: AgentDiscordLink,
  avatarUrls: ReadonlyMap<string, string>,
) {
  const discordId = agent.discordId?.trim()
  return discordId ? avatarUrls.get(discordId) ?? null : null
}
