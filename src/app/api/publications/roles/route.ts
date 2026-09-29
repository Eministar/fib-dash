import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { getDiscordGuildRoles } from '@/lib/discord-integration'
import { publicationFailure } from '@/lib/publications-server'

/** Discord-Rollen zur Auswahl für geschlossene Aushänge. */
export async function GET() {
  try {
    await requirePermission('publications:manage')
    const roles = await getDiscordGuildRoles()
    return success(roles.filter((role) => role.name !== '@everyone').map((role) => ({ id: role.id, name: role.name })))
  } catch (e: unknown) {
    return publicationFailure(e)
  }
}
