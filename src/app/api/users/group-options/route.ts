import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, forbidden } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { getDiscordConfig, getDiscordGuildRoles } from '@/lib/discord-integration'

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['users:manage'])

    const [groups, config] = await Promise.all([
      prisma.userGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      getDiscordConfig(),
    ])

    // Fetch guild roles for display names (best-effort)
    const guildRoles = await getDiscordGuildRoles().catch(() => [])
    const roleNamesById = new Map(guildRoles.map((r) => [r.id, r.name]))

    // Build per-group Discord role info
    const groupRoles = groups.map((group) => {
      const roleIds = config.authGroupRoleMap[group.id] ?? []
      return {
        id: group.id,
        name: group.name,
        discordRoles: roleIds.map((roleId) => ({
          id: roleId,
          name: roleNamesById.get(roleId) ?? roleId,
        })),
      }
    })

    return success(groupRoles)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
