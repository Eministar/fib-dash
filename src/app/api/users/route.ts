import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized , forbidden } from '@/lib/api-response'
import { userGroupDelegate } from '@/lib/prisma-delegates'
import { listDiscordAuthMembers, serializeDiscordBackedUser } from '@/lib/discord-auth'

function serializeUser<T extends {
  permissions: unknown
  groupId: string | null
  group: { id: string; name: string } | null
  groupMemberships: { group: { id: string; name: string } }[]
  discordId: string | null
  discordAvatar?: string | null
  discordDiscriminator?: string | null
}>(user: T) {
  return serializeDiscordBackedUser(user)
}

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['users:manage'])
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        discordId: true,
        discordUsername: true,
        discordGlobalName: true,
        discordAvatar: true,
        discordDiscriminator: true,
        lastLoginAt: true,
        groupId: true,
        group: { select: { id: true, name: true } },
        permissions: true,
        groupMemberships: {
          select: { group: { select: { id: true, name: true } } },
        },
        unitAssignments: {
          select: { unit: { select: { id: true, name: true, key: true } } },
        },
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    const localUsers = users.map(serializeUser)
    const localDiscordIds = new Set(localUsers.map((user) => user.discordId).filter(Boolean))
    const groups = await userGroupDelegate(prisma).findMany({ select: { id: true, name: true } })
    const groupsById = new Map(groups.map((group) => [group.id, group]))
    const discordMembers = await listDiscordAuthMembers().catch(() => [])
    const discordOnlyUsers = discordMembers
      .filter((member) => !localDiscordIds.has(member.profile.user.id))
      .map((member) => {
        const groupIds = member.groupIds.filter((groupId) => groupsById.has(groupId))
        return {
          id: `discord:${member.profile.user.id}`,
          username: member.profile.user.username,
          displayName: member.displayName,
          discordId: member.profile.user.id,
          discordUsername: member.profile.user.username,
          discordGlobalName: member.profile.user.global_name ?? null,
          discordAvatar: member.profile.user.avatar ?? null,
          discordDiscriminator: member.profile.user.discriminator ?? null,
          avatarUrl: member.avatarUrl,
          groupId: groupIds[0] ?? null,
          groupIds,
          groups: groupIds.map((groupId) => groupsById.get(groupId)).filter(Boolean),
          permissions: [],
          createdAt: null,
          lastLoginAt: null,
          discordOnly: true,
        }
      })

    return success([...localUsers, ...discordOnlyUsers])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

export async function POST() {
  try {
    await requireAuth(['ADMIN'], ['users:manage'])
    return error('Benutzer werden ausschließlich über Discord angelegt.', 410)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
