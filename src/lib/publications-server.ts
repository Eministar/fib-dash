import { z } from 'zod'
import { error, unauthorized } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { getDiscordGuildMember } from '@/lib/discord-integration'
import { hasPermission } from '@/lib/permissions'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { readRoleIds } from '@/lib/publications'

export function publicationFailure(e: unknown) {
  if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? 'Ungültige Eingabe')
  if (isUniqueConstraintError(e)) return error('Dieser Link-Name ist bereits vergeben.', 409)
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export type PublicationViewer = {
  loggedIn: boolean
  /** Verwalter sehen alle geschlossenen Aushänge. */
  manage: boolean
  roles: Set<string>
}

/** Einmal pro Seitenaufruf: wer schaut zu und welche Discord-Rollen hat er gerade? */
export async function publicationViewer(): Promise<PublicationViewer> {
  const user = await getCurrentUser()
  if (!user) return { loggedIn: false, manage: false, roles: new Set() }
  const manage = hasPermission(user, 'publications:manage')
  // Rollen live vom Discord-Server lesen: eine entzogene Rolle sperrt sofort.
  const member = !manage && user.discordId ? await getDiscordGuildMember(user.discordId) : null
  return { loggedIn: true, manage, roles: new Set(member?.roles ?? []) }
}

export function publicationAccess(publication: { access: string; roleIds: unknown }, viewer: PublicationViewer): 'allowed' | 'login' | 'denied' {
  if (publication.access !== 'ROLES') return 'allowed'
  if (!viewer.loggedIn) return 'login'
  if (viewer.manage) return 'allowed'
  return readRoleIds(publication.roleIds).some((id) => viewer.roles.has(id)) ? 'allowed' : 'denied'
}
