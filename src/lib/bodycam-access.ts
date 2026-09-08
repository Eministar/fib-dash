import { getCurrentAuth, type CurrentAuth } from './auth'
import { hasPermission } from './permissions'
import { getDiscordConfig, getDiscordGuildMember } from './discord-integration'
import { investigationVisibilityWhere } from './investigations'

export async function bodycamAccess() {
  const auth = await getCurrentAuth()
  return resolveBodycamAccess(auth, async discordId => {
    const config = await getDiscordConfig()
    if (!config.bodycamViewerRoleId) return false
    const member = await getDiscordGuildMember(discordId, config.guildId)
    return member?.roles?.includes(config.bodycamViewerRoleId) ?? false
  })
}

export async function resolveBodycamAccess(auth: CurrentAuth | null, hasViewerRole: (discordId: string) => Promise<boolean>) {
  if (!auth) throw new Error('Unauthorized')
  const full = hasPermission(auth.user, 'investigations:view')
  if (full) return { user: auth.user, full, where: investigationVisibilityWhere(auth.user) }
  // Role access is session-only: it must not bypass API-token scopes.
  if (auth.kind === 'cookie' && auth.user.discordId) {
    if (await hasViewerRole(auth.user.discordId)) return { user: auth.user, full: false, where: { classified: false } }
  }
  throw new Error('Forbidden')
}
