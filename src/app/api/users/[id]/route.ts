import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound, forbidden } from '@/lib/api-response'
import { sanitizePermissions } from '@/lib/permissions'
import { getDiscordConfig, getDiscordGuildMember, addDiscordRoleToMember, removeDiscordRoleFromMember } from '@/lib/discord-integration'
import { serializeDiscordBackedUser, upsertDiscordUser } from '@/lib/discord-auth'
import { getManagedUnitKeysForUser, hasGlobalAdministratorAccess, unitLeadershipChangeError } from '@/lib/unit-leadership'

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

async function ensureUserId(id: string) {
  if (!id.startsWith('discord:')) return id
  const discordId = id.slice('discord:'.length)
  // If user already logged in and exists in DB, avoid an unnecessary Discord round-trip
  const existing = await prisma.user.findFirst({ where: { discordId }, select: { id: true } })
  if (existing) return existing.id
  // User not yet in DB — create via Discord sync
  const member = await getDiscordGuildMember(discordId)
  if (!member?.user) throw new Error('Discord-Benutzer nicht gefunden')
  const user = await upsertDiscordUser({
    user: member.user,
    roles: member.roles ?? [],
    nick: member.nick,
    avatar: member.avatar,
  })
  return user.id
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await requireAuth(['ADMIN'], ['users:manage'])
    const { id: rawId } = await params
    const id = await ensureUserId(rawId)
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if ('permissions' in body) data.permissions = sanitizePermissions(body.permissions)

    // Manual group assignment — done in separate transaction to avoid primary key conflicts
    // (user may already have a Discord-synced membership for a group they're being manually added to)
    if ('groupIds' in body && Array.isArray(body.groupIds)) {
      const requestedGroupIds = body.groupIds.filter((gid: unknown): gid is string => typeof gid === 'string' && gid.length > 0)
      const validGroups = requestedGroupIds.length > 0
        ? await prisma.userGroup.findMany({ where: { id: { in: requestedGroupIds } }, select: { id: true } })
        : []
      const validGroupIds = validGroups.map((g) => g.id)

      await prisma.$transaction(async (tx) => {
        // Remove all current manual memberships
        await tx.userGroupMembership.deleteMany({ where: { userId: id, source: 'manual' } })
        // Upsert each desired group — if already Discord-assigned, upgrade to 'manual' so it survives login syncs
        for (const groupId of validGroupIds) {
          await tx.userGroupMembership.upsert({
            where: { userId_groupId: { userId: id, groupId } },
            update: { source: 'manual' },
            create: { userId: id, groupId, source: 'manual' },
          })
        }
      })
    }

    // Direkte Unit-Zuweisung (analog Gruppen)
    if ('unitIds' in body && Array.isArray(body.unitIds)) {
      const requestedUnitIds = body.unitIds.filter((uid: unknown): uid is string => typeof uid === 'string' && uid.length > 0)
      const validUnits = requestedUnitIds.length > 0
        ? await prisma.unit.findMany({ where: { id: { in: requestedUnitIds } }, select: { id: true, key: true } })
        : []
      const validUnitIds = validUnits.map((u) => u.id)

      if (!hasGlobalAdministratorAccess(currentUser)) {
        const [existingAssignments, managedUnitKeys] = await Promise.all([
          prisma.userUnitAssignment.findMany({
            where: { userId: id },
            select: { unit: { select: { key: true } } },
          }),
          getManagedUnitKeysForUser(currentUser),
        ])
        const leadershipError = unitLeadershipChangeError(
          existingAssignments.map((assignment) => assignment.unit.key),
          validUnits.map((unit) => unit.key),
          managedUnitKeys,
        )
        if (leadershipError) return error(leadershipError, 403)
      }

      await prisma.$transaction(async (tx) => {
        await tx.userUnitAssignment.deleteMany({ where: { userId: id } })
        for (const unitId of validUnitIds) {
          await tx.userUnitAssignment.create({ data: { userId: id, unitId } })
        }
      })
    }

    const user = await prisma.user.update({
      where: { id },
      data,
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
          select: { group: { select: { id: true, name: true } }, source: true },
        },
        unitAssignments: {
          select: { unit: { select: { id: true, name: true, key: true } } },
        },
        createdAt: true,
      },
    })

    // Sync selected Discord roles for manually assigned groups
    if ('discordRoleIds' in body && Array.isArray(body.discordRoleIds) && user.discordId) {
      const config = await getDiscordConfig()
      const allGroupRoleIds = new Set(Object.values(config.authGroupRoleMap).flat())
      const desiredRoleIds = new Set(
        body.discordRoleIds.filter((rid: unknown): rid is string => typeof rid === 'string' && /^\d{17,22}$/.test(rid))
      )
      // Add desired roles, remove undesired auth-group roles
      for (const roleId of allGroupRoleIds) {
        if (desiredRoleIds.has(roleId)) {
          await addDiscordRoleToMember(user.discordId, roleId)
        } else {
          await removeDiscordRoleFromMember(user.discordId, roleId)
        }
      }
    }

    return success(serializeUser(user))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await requireAuth(['ADMIN'], ['users:manage'])
    const { id } = await params
    if (id.startsWith('discord:')) return success({ message: 'Discord-Benutzer bleibt sichtbar' })

    if (currentUser.id === id) return error('Du kannst dich nicht selbst löschen')

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return notFound('Benutzer')

    await prisma.user.delete({ where: { id } })
    return success({ message: 'Benutzer gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
