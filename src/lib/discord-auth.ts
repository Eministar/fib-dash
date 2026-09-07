import { prisma } from '@/lib/prisma'
import { getDiscordConfig, getDiscordGuildMember, getDiscordGuildMembers, type DiscordApiUser } from '@/lib/discord-integration'
import { sanitizePermissions } from '@/lib/permissions'
import { resolveUserDisplayName } from '@/lib/user-display-name'

const API_BASE = 'https://discord.com/api/v10'

type DiscordTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
}

type DiscordMemberProfile = {
  user: DiscordApiUser
  roles: string[]
  nick?: string | null
  avatar?: string | null
}

export class DiscordAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscordAuthError'
  }
}

function clientId() {
  return (
    process.env.DISCORD_CLIENT_ID?.trim() ||
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    process.env.FIB_DISCORD_CLIENT_ID?.trim() ||
    process.env.FIB_DISCORD_APPLICATION_ID?.trim() ||
    ''
  )
}

function clientSecret() {
  return process.env.DISCORD_CLIENT_SECRET?.trim() || process.env.FIB_DISCORD_CLIENT_SECRET?.trim() || ''
}

function cleanDisplayName(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function profileDisplayName(profile: DiscordMemberProfile) {
  return (
    cleanDisplayName(profile.nick) ||
    cleanDisplayName(profile.user.global_name) ||
    cleanDisplayName(profile.user.username) ||
    profile.user.id
  )
}

function usernameBase(profile: DiscordMemberProfile) {
  const base = profileDisplayName(profile)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || `discord-${profile.user.id}`
}

async function uniqueUsername(profile: DiscordMemberProfile, existingUserId?: string) {
  const base = usernameBase(profile)
  const candidates = [base, `${base}-${profile.user.id.slice(-4)}`, `discord-${profile.user.id}`]

  for (const candidate of candidates) {
    const existing = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })
    if (!existing || existing.id === existingUserId) return candidate
  }

  return `discord-${profile.user.id}`
}

function defaultAvatarIndex(discordId: string, discriminator?: string) {
  const parsedDiscriminator = Number.parseInt(discriminator || '', 10)
  if (Number.isFinite(parsedDiscriminator) && parsedDiscriminator > 0) return parsedDiscriminator % 5

  return discordId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
}

export function discordAvatarUrl(user: Pick<DiscordApiUser, 'id' | 'avatar'> & { discriminator?: string | null }) {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=96`
  }
  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(user.id, user.discriminator ?? undefined)}.png`
}

export function storedDiscordAvatarUrl(user: {
  discordId?: string | null
  discordAvatar?: string | null
  discordDiscriminator?: string | null
}) {
  if (!user.discordId) return null
  return discordAvatarUrl({
    id: user.discordId,
    avatar: user.discordAvatar ?? null,
    discriminator: user.discordDiscriminator ?? undefined,
  })
}

function matchingGroupIds(roleIds: string[], groupRoleMap: Record<string, string[]>) {
  const roles = new Set(roleIds)
  return Array.from(new Set(
    Object.entries(groupRoleMap)
      .filter(([, groupRoleIds]) => groupRoleIds.some((roleId) => roles.has(roleId)))
      .map(([groupId]) => groupId)
      .filter(Boolean),
  ))
}

function hasLoginRole(roleIds: string[], loginRoleIds: string[], groupRoleMap: Record<string, string[]>) {
  const roles = new Set(roleIds)
  const groupRoleIds = Object.values(groupRoleMap).flat()
  const allowedRoles = Array.from(new Set([...loginRoleIds, ...groupRoleIds]))
  if (allowedRoles.length === 0) throw new DiscordAuthError('Discord-Login ist nicht konfiguriert')
  return allowedRoles.some((roleId) => roles.has(roleId))
}

function hasApplicantPortalRole(roleIds: string[], applicantRoleIds: string[]) {
  const roles = new Set(roleIds)
  const allowedRoles = Array.from(new Set(applicantRoleIds))
  if (allowedRoles.length === 0) throw new DiscordAuthError('Bewerberportal ist nicht konfiguriert')
  return allowedRoles.some((roleId) => roles.has(roleId))
}

export async function exchangeDiscordCode(code: string, redirectUri: string) {
  const config = await getDiscordConfig()
  const id = clientId() || config.applicationId
  const secret = clientSecret()
  if (!id || !secret) throw new DiscordAuthError('Discord OAuth ist nicht vollständig konfiguriert')

  const response = await fetch(`${API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new DiscordAuthError('Discord-Code konnte nicht eingelöst werden')
  }

  return response.json() as Promise<DiscordTokenResponse>
}

export async function fetchDiscordCurrentUser(accessToken: string) {
  const response = await fetch(`${API_BASE}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) throw new DiscordAuthError('Discord-Profil konnte nicht geladen werden')
  return response.json() as Promise<DiscordApiUser>
}

export async function syncDiscordUserProfile(user: DiscordApiUser) {
  const member = await getDiscordGuildMember(user.id)
  if (!member) throw new DiscordAuthError('Du bist auf dem konfigurierten Discord-Server nicht vorhanden')

  return upsertDiscordUser({
    user,
    roles: member.roles ?? [],
    nick: member.nick,
    avatar: member.avatar,
  })
}

export async function syncDiscordApplicantProfile(user: DiscordApiUser) {
  const member = await getDiscordGuildMember(user.id)
  if (!member) throw new DiscordAuthError('Du bist auf dem konfigurierten Discord-Server nicht vorhanden')

  return upsertDiscordApplicant({
    user,
    roles: member.roles ?? [],
    nick: member.nick,
    avatar: member.avatar,
  })
}

/**
 * Login ausschließlich zum Unterschreiben eines Arbeitsvertrags.
 *
 * Neueinsteiger haben oft weder Dashboard- noch Bewerber-Rolle — sie könnten
 * ihren eigenen Vertrag sonst gar nicht öffnen. Deshalb reicht hier die
 * Mitgliedschaft auf dem konfigurierten Discord-Server. Der so angelegte User
 * bekommt bewusst KEINE Gruppen und KEINE Rechte; die eigentliche Berechtigung
 * entsteht erst dadurch, dass die Discord-ID zum Vertrag passt.
 */
export async function syncDiscordContractSignerProfile(user: DiscordApiUser) {
  const member = await getDiscordGuildMember(user.id)
  if (!member) throw new DiscordAuthError('Du bist auf dem konfigurierten Discord-Server nicht vorhanden')

  return upsertDiscordContractSigner({
    user,
    roles: member.roles ?? [],
    nick: member.nick,
    avatar: member.avatar,
  })
}

export async function upsertDiscordContractSigner(profile: DiscordMemberProfile) {
  const existing = await prisma.user.findFirst({ where: { discordId: profile.user.id }, select: { id: true } })
  const username = await uniqueUsername(profile, existing?.id)

  const data = {
    username,
    displayName: profileDisplayName(profile),
    discordId: profile.user.id,
    discordUsername: profile.user.username,
    discordGlobalName: profile.user.global_name ?? null,
    discordAvatar: profile.user.avatar ?? null,
    discordDiscriminator: profile.user.discriminator ?? null,
    lastLoginAt: new Date(),
  }

  if (existing) {
    // Wichtig: bestehende Gruppen/Rechte NICHT anfassen — ein Agent, der sich
    // über den Vertragslink einloggt, darf sein Dashboard nicht verlieren.
    return prisma.user.update({ where: { id: existing.id }, data })
  }

  return prisma.user.create({
    data: {
      ...data,
      passwordHash: null,
      permissions: [],
      groupId: null,
    },
  })
}

export async function upsertDiscordUser(profile: DiscordMemberProfile) {
  const config = await getDiscordConfig()
  if (!hasLoginRole(profile.roles, config.authLoginRoleIds, config.authGroupRoleMap)) {
    throw new DiscordAuthError('Dir fehlt die benötigte Discord-Rolle für dieses Dashboard')
  }

  const groupIds = matchingGroupIds(profile.roles, config.authGroupRoleMap)
  const existingGroups = groupIds.length
    ? await prisma.userGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true } })
    : []
  const validGroupIds = new Set(existingGroups.map((group) => group.id))
  const safeGroupIds = groupIds.filter((groupId) => validGroupIds.has(groupId))

  const existing = await prisma.user.findFirst({ where: { discordId: profile.user.id }, select: { id: true } })
  const username = await uniqueUsername(profile, existing?.id)
  const displayName = await resolveUserDisplayName({
    displayName: profileDisplayName(profile),
    discordId: profile.user.id,
  })

  const data = {
    username,
    displayName,
    discordId: profile.user.id,
    discordUsername: profile.user.username,
    discordGlobalName: profile.user.global_name ?? null,
    discordAvatar: profile.user.avatar ?? null,
    discordDiscriminator: profile.user.discriminator ?? null,
    groupId: safeGroupIds[0] ?? null,
    lastLoginAt: new Date(),
  }

  if (existing) {
    // Update profile separately from membership sync to avoid primary key conflicts.
    // Manual memberships (source: 'manual') are preserved; Discord ones are replaced.
    const updatedUser = await prisma.user.update({
      where: { id: existing.id },
      data,
      include: {
        group: { select: { id: true, name: true, permissions: true } },
        groupMemberships: {
          select: { group: { select: { id: true, name: true, permissions: true } } },
        },
      },
    })

    await prisma.$transaction([
      prisma.userGroupMembership.deleteMany({
        where: { userId: existing.id, source: 'discord' },
      }),
      prisma.userGroupMembership.createMany({
        data: safeGroupIds.map((groupId) => ({ userId: existing.id, groupId, source: 'discord' })),
        skipDuplicates: true, // skip if already manually assigned with same (userId, groupId)
      }),
    ])

    return updatedUser
  }

  return prisma.user.create({
    data: {
      ...data,
      passwordHash: null,
      permissions: [],
      groupMemberships: {
        create: safeGroupIds.map((groupId) => ({ groupId, source: 'discord' })),
      },
    },
    include: {
      group: { select: { id: true, name: true, permissions: true } },
      groupMemberships: {
        select: { group: { select: { id: true, name: true, permissions: true } } },
      },
    },
  })
}

export async function upsertDiscordApplicant(profile: DiscordMemberProfile) {
  const config = await getDiscordConfig()
  if (!hasApplicantPortalRole(profile.roles, config.applicantRoleIds)) {
    throw new DiscordAuthError('Dir fehlt die benötigte Discord-Rolle für das Bewerberportal')
  }

  const existing = await prisma.user.findFirst({ where: { discordId: profile.user.id }, select: { id: true } })
  const username = await uniqueUsername(profile, existing?.id)
  const displayName = profileDisplayName(profile)

  const data = {
    username,
    displayName,
    discordId: profile.user.id,
    discordUsername: profile.user.username,
    discordGlobalName: profile.user.global_name ?? null,
    discordAvatar: profile.user.avatar ?? null,
    discordDiscriminator: profile.user.discriminator ?? null,
    lastLoginAt: new Date(),
  }

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
      include: {
        group: { select: { id: true, name: true, permissions: true } },
        groupMemberships: {
          select: { group: { select: { id: true, name: true, permissions: true } } },
        },
      },
    })
  }

  return prisma.user.create({
    data: {
      ...data,
      passwordHash: null,
      permissions: [],
      groupId: null,
    },
    include: {
      group: { select: { id: true, name: true, permissions: true } },
      groupMemberships: {
        select: { group: { select: { id: true, name: true, permissions: true } } },
      },
    },
  })
}

export function serializeDiscordBackedUser<T extends {
  permissions: unknown
  groupId: string | null
  group: { id: string; name: string } | null
  groupMemberships: { group: { id: string; name: string } }[]
  discordId: string | null
  discordAvatar?: string | null
  discordDiscriminator?: string | null
}>(user: T) {
  const groupsById = new Map(user.groupMemberships.map((membership) => [membership.group.id, membership.group]))
  if (user.group && !groupsById.has(user.group.id)) groupsById.set(user.group.id, user.group)
  const groups = Array.from(groupsById.values())
  const rest = Object.fromEntries(
    Object.entries(user).filter(([key]) => key !== 'groupMemberships' && key !== 'unitAssignments'),
  ) as Omit<T, 'groupMemberships'>
  const unitAssignments = (user as { unitAssignments?: { unit: { id: string; name: string; key: string } }[] }).unitAssignments ?? []
  const units = unitAssignments.map((assignment) => assignment.unit)
  return {
    ...rest,
    groupIds: groups.map((group) => group.id),
    groups,
    unitIds: units.map((unit) => unit.id),
    units,
    permissions: sanitizePermissions(user.permissions),
    avatarUrl: storedDiscordAvatarUrl(user),
  }
}

export async function listDiscordAuthMembers() {
  const config = await getDiscordConfig()
  const members = await getDiscordGuildMembers(config.guildId)
  return members
    .filter((member): member is DiscordMemberProfile => Boolean(member.user?.id))
    .filter((member) => {
      try {
        return hasLoginRole(member.roles ?? [], config.authLoginRoleIds, config.authGroupRoleMap)
      } catch {
        return false
      }
    })
    .map((member) => ({
      profile: {
        user: member.user,
        roles: member.roles ?? [],
        nick: member.nick,
        avatar: member.avatar,
      },
      groupIds: matchingGroupIds(member.roles ?? [], config.authGroupRoleMap),
      avatarUrl: discordAvatarUrl(member.user),
      displayName: profileDisplayName({
        user: member.user,
        roles: member.roles ?? [],
        nick: member.nick,
        avatar: member.avatar,
      }),
    }))
}
