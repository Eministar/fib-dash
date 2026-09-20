import { getCurrentAuth, type CurrentAuth } from './auth'
import { hasPermission } from './permissions'
import { getDiscordConfig, getDiscordGuildMember } from './discord-integration'
import { canAccessInvestigation, investigationVisibilityWhere, type InvestigationAccessShape } from './investigations'

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
  if (auth.kind === 'cookie' && auth.user.discordId) {
    // Die Leserolle gibt den kompletten Katalog frei — auch Clips aus
    // Verschlusssachen. Sie ist damit bewusst breiter als die Aktenrechte des
    // Nutzers, aber sie gilt ausschliesslich fuer Clips, nicht fuer die Akten.
    if (await hasViewerRole(auth.user.discordId)) return { user: auth.user, full: false, roleOnly: true, where: {} }
  }
  throw new Error('Forbidden')
}

export type BodycamAccess = Awaited<ReturnType<typeof resolveBodycamAccess>>

/**
 * Einzelpruefung fuer einen konkreten Clip. Liegt hier und nicht in der Route,
 * damit Listen-Where und Datei-Auslieferung nicht auseinanderlaufen koennen.
 */
export function canAccessBodycamClip(
  access: Pick<BodycamAccess, 'user' | 'full' | 'roleOnly'>,
  investigation: InvestigationAccessShape,
) {
  if (access.roleOnly) return true
  if (!access.full && investigation.classified) return false
  return canAccessInvestigation(access.user, investigation)
}
