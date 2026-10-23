import { getCurrentAuth, type CurrentAuth } from '../auth'
import { hasPermission } from '../permissions'
import { getDiscordConfig, getDiscordGuildMember } from '../discord/discord-integration'
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
  if (full) return { user: auth.user, full, roleOnly: false, where: investigationVisibilityWhere(auth.user) }
  // Role access is session-only: it must not bypass API-token scopes.
  if (auth.kind === 'cookie' && !auth.portal && auth.user.discordId) {
    // Die Leserolle gibt den kompletten Katalog frei, aber ausschliesslich
    // die Clips, nicht die Akten.
    if (await hasViewerRole(auth.user.discordId)) return { user: auth.user, full: false, roleOnly: true, where: {} }
  }
  throw new Error('Forbidden')
}

export type BodycamAccess = Awaited<ReturnType<typeof resolveBodycamAccess>>

/**
 * Einzelpruefung fuer einen konkreten Clip: Akteneinsicht oder Bodycam-Rolle.
 * Liegt hier und nicht in der Route, damit Listen-Where und
 * Datei-Auslieferung nicht auseinanderlaufen koennen.
 */
export function canAccessBodycamClip(access: Pick<BodycamAccess, 'full' | 'roleOnly'>) {
  return access.full || access.roleOnly
}
