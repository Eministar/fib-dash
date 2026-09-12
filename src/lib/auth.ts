import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { cookies, headers } from 'next/headers'
import { prisma } from './prisma'
import { automaticPermissionsForRoleNames, hasAnyPermission, resolveEffectivePermissions, intersectPermissions, normalizePermissions, PERMISSIONS, type Permission } from './permissions'
import { storedDiscordAvatarUrl } from './discord-auth'
import { isDiscordUserAdmin } from './discord-integration'
import { createHash } from 'node:crypto'
import { resolveUserDisplayName } from './user-display-name'
import { agentUnitKeys } from './agent-units'
import { activateChangeTracking } from './change-history-context'
import { describeTrackedChange, pathHasExternalSideEffects } from './change-history-tracking'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret'

export interface JWTPayload {
  userId: string
  username: string
}

export interface CurrentUser {
  id: string
  username: string
  displayName: string
  discordId: string | null
  avatarUrl: string | null
  groups: { id: string; name: string }[]
  permissions: Permission[]
}

export type AuthKind = 'cookie' | 'api'

export interface CurrentAuth {
  kind: AuthKind
  user: CurrentUser
  /** Nur gesetzt, wenn kind === 'api'. */
  api?: {
    tokenId: string
    tokenName: string
    tokenPrefix: string
    tokenOwnerDisplayName: string
    scopes: Permission[]
  }
  /**
   * Gesetzt, wenn ein API-Token-Request den `X-Discord-Id` Header trägt
   * (Impersonation). Die effektiven Rechte sind in diesem Fall die
   * Schnittmenge aus Token-Scopes und den Rechten des impersonierten Users.
   */
  impersonation?: {
    discordId: string
    userId: string
    displayName: string
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function extractBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  return match ? match[1] : null
}

async function attachRequestedChangeTracking(
  auth: CurrentAuth,
  headerStore: { get(name: string): string | null },
): Promise<CurrentAuth> {
  const changeSetId = headerStore.get('x-change-set-id')?.trim() ?? ''
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(changeSetId)) return auth

  const method = (headerStore.get('x-change-method') || 'PATCH').toUpperCase().slice(0, 10)
  const path = (headerStore.get('x-change-path') || '/api').slice(0, 2_000)
  const existing = await prisma.changeSet.findUnique({
    where: { id: changeSetId },
    select: { userId: true, status: true },
  })

  if (existing && (existing.userId !== auth.user.id || existing.status !== 'PENDING')) return auth
  if (!existing) {
    await prisma.changeSet.create({
      data: {
        id: changeSetId,
        userId: auth.user.id,
        method,
        path,
        label: describeTrackedChange(method, path),
        hasExternalSideEffects: pathHasExternalSideEffects(path),
      },
    })
  }

  activateChangeTracking({ changeSetId, userId: auth.user.id })
  return auth
}

/**
 * Authentifiziert aus Cookie ODER `Authorization: Bearer fib_…`.
 * Liefert `null`, wenn nichts Authentifiziertes gefunden wurde.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const auth = await getCurrentAuth()
  return auth?.user ?? null
}

/** Confidential modules authenticate without creating general change-history entries. */
export async function getConfidentialUser(): Promise<CurrentUser | null> {
  const auth = await getCurrentAuth(false)
  return auth?.user ?? null
}

/**
 * Wie {@link getCurrentUser}, liefert aber zusätzlich den Auth-Kontext
 * (Cookie vs. API-Token) — nützlich für Usage-Tracking und Rate-Limiting.
 */
export async function getCurrentAuth(trackChanges = true): Promise<CurrentAuth | null> {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const bearer = extractBearer(headerStore.get('authorization'))
  if (bearer && bearer.startsWith('fib_')) {
    const tokenHash = sha256(bearer)
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (row && !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now()) && row.user) {
      const tokenScopes = effectiveTokenScopes(row.scopes, await loadUserPermissions(row.userId))

      // Optional: X-Discord-Id-Header = "handle als dieser User"
      // → effektive Rechte = intersect(token-scopes, user-permissions)
      const impersonateDiscordId = headerStore.get('x-discord-id')?.trim()
      let effectiveScopes = tokenScopes
      let effectiveUser: CurrentUser | null = null
      let impersonation: CurrentAuth['impersonation'] | undefined

      if (impersonateDiscordId) {
        if (!/^\d{17,22}$/.test(impersonateDiscordId)) return null
        const impersonated = await loadUserByDiscordId(impersonateDiscordId)
        if (!impersonated) return null
        effectiveScopes = intersectPermissions(tokenScopes, impersonated.permissions)
        effectiveUser = {
          ...impersonated,
          groups: [{ id: 'api-token', name: 'API-Token' }],
          permissions: effectiveScopes,
        }
        impersonation = {
          discordId: impersonateDiscordId,
          userId: impersonated.id,
          displayName: impersonated.displayName,
        }
      } else {
        effectiveUser = buildApiUser(row.user, tokenScopes)
      }

      if (!effectiveUser) return null

      const resolvedAuth: CurrentAuth = {
        kind: 'api',
        user: effectiveUser,
        api: {
          tokenId: row.id,
          tokenName: row.name,
          tokenPrefix: row.prefix,
          tokenOwnerDisplayName: row.user.displayName,
          scopes: effectiveScopes,
        },
        impersonation,
      }
      return trackChanges ? attachRequestedChangeTracking(resolvedAuth, headerStore) : resolvedAuth
    }
    return null
  }

  const cookieToken = cookieStore.get('auth-token')?.value
  if (cookieToken) {
    const payload = verifyToken(cookieToken)
    if (payload) {
      const user = await loadUserForAuth(payload.userId)
      if (user) return trackChanges ? attachRequestedChangeTracking({ kind: 'cookie', user }, headerStore) : { kind: 'cookie', user }
    }
  }

  return null
}

/**
 * Lädt einen User per Discord-Snowflake inkl. effektiver Permissions + Gruppen.
 * Liefert `null`, wenn kein User mit dieser Discord-ID existiert.
 */
/**
 * Ermittelt die zusätzlichen Rechte, die ein Login-User über Units erhält.
 * Vereinigung aus (a) direkten Zuweisungen und (b) Agent-basiert
 * (discordId → Agent, nicht gekündigt → dessen Unit-Keys). Es zählen nur
 * `active` Units. Rückgabe: Liste roher `permissions`-Arrays (werden vom
 * Aufrufer zusammen mit den Gruppenrechten normalisiert).
 */
async function loadUserUnitPermissions(params: { userId: string; discordId: string | null }): Promise<unknown[]> {
  const { userId, discordId } = params
  const unitPermsLists: unknown[] = []
  const seenUnitIds = new Set<string>()
  const seenGroupIds = new Set<string>()

  const addUnitAccess = (unit: {
    id: string
    key: string
    name: string
    permissions: unknown
    isLeadership?: boolean
    group?: {
      id: string
      key: string
      name: string
      permissions: unknown
      active: boolean
    } | null
  }) => {
    if (seenUnitIds.has(unit.id)) return
    if (unit.group) {
      if (!unit.group.active) return
      if (!seenGroupIds.has(unit.group.id)) {
        seenGroupIds.add(unit.group.id)
        unitPermsLists.push(unit.group.permissions)
        unitPermsLists.push(automaticPermissionsForRoleNames([unit.group.key, unit.group.name]))
      }
      if (unit.isLeadership) unitPermsLists.push(['unit-leadership:manage'])
    } else {
      unitPermsLists.push(unit.permissions)
      unitPermsLists.push(automaticPermissionsForRoleNames([unit.key, unit.name]))
    }
    seenUnitIds.add(unit.id)
  }

  const directAssignments = await prisma.userUnitAssignment.findMany({
    where: { userId, unit: { active: true } },
    select: {
      unit: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: true,
          isLeadership: true,
          group: { select: { id: true, key: true, name: true, permissions: true, active: true } },
        },
      },
    },
  })
  for (const assignment of directAssignments) {
    addUnitAccess(assignment.unit)
  }

  if (discordId) {
    const agent = await prisma.agent.findFirst({
      where: { discordId, status: { not: 'TERMINATED' } },
      select: { unit: true, units: true },
    })
    const keys = agent ? agentUnitKeys(agent) : []
    if (keys.length > 0) {
      const units = await prisma.unit.findMany({
        where: { key: { in: keys }, active: true },
        select: {
          id: true,
          key: true,
          name: true,
          permissions: true,
          isLeadership: true,
          group: { select: { id: true, key: true, name: true, permissions: true, active: true } },
        },
      })
      for (const unit of units) {
        addUnitAccess(unit)
      }
    }
  }

  return unitPermsLists
}

async function loadUserByDiscordId(discordId: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findFirst({
    where: { discordId },
    select: {
      id: true,
      username: true,
      displayName: true,
      discordId: true,
      discordAvatar: true,
      discordDiscriminator: true,
      permissions: true,
      discordRolePermissions: true,
      group: { select: { id: true, name: true, permissions: true } },
      groupMemberships: {
        select: { group: { select: { id: true, name: true, permissions: true } } },
      },
    },
  })
  if (!user) return null

  const groupsById = new Map(user.groupMemberships.map((m) => [m.group.id, m.group]))
  if (user.group && !groupsById.has(user.group.id)) groupsById.set(user.group.id, user.group)
  const groups = Array.from(groupsById.values())
  const unitPerms = await loadUserUnitPermissions({ userId: user.id, discordId: user.discordId })
  const permissions = resolveEffectivePermissions(
    user.permissions,
    [
      user.discordRolePermissions,
      ...groups.map((g) => g.permissions),
      automaticPermissionsForRoleNames(groups.map((g) => g.name)),
      ...unitPerms,
    ],
  )
  const displayName = await resolveUserDisplayName(user)

  return {
    id: user.id,
    username: user.username,
    displayName,
    discordId: user.discordId,
    avatarUrl: storedDiscordAvatarUrl(user),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    permissions,
  }
}

/** Lädt den effektiven Dashboard-User für signierte Discord-Interactions. */
export async function getUserByDiscordId(discordId: string) {
  return loadUserByDiscordId(discordId)
}

async function loadUserForAuth(userId: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      discordId: true,
      discordAvatar: true,
      discordDiscriminator: true,
      permissions: true,
      discordRolePermissions: true,
      group: { select: { id: true, name: true, permissions: true } },
      groupMemberships: {
        select: { group: { select: { id: true, name: true, permissions: true } } },
      },
    },
  })
  if (!user) return null

  const groupsById = new Map(user.groupMemberships.map((m) => [m.group.id, m.group]))
  if (user.group && !groupsById.has(user.group.id)) groupsById.set(user.group.id, user.group)
  const groups = Array.from(groupsById.values())

  const unitPerms = await loadUserUnitPermissions({ userId: user.id, discordId: user.discordId })
  let effectivePermissions = resolveEffectivePermissions(
    user.permissions,
    [
      user.discordRolePermissions,
      ...groups.map((g) => g.permissions),
      automaticPermissionsForRoleNames(groups.map((g) => g.name)),
      ...unitPerms,
    ],
  )
  const groupList = groups.map((g) => ({ id: g.id, name: g.name }))

  if (groups.some((g) => ['admin', 'administration'].includes(g.name.toLowerCase()))) {
    effectivePermissions = [...PERMISSIONS]
  }

  if (user.discordId && (await isDiscordUserAdmin(user.discordId))) {
    effectivePermissions = [...PERMISSIONS]
    if (!groupList.some((g) => g.name.toLowerCase() === 'admin')) {
      groupList.unshift({ id: 'discord-admin', name: 'Admin' })
    }
  }
  const displayName = await resolveUserDisplayName(user)

  return {
    id: user.id,
    username: user.username,
    displayName,
    discordId: user.discordId,
    avatarUrl: storedDiscordAvatarUrl(user),
    groups: groupList,
    permissions: effectivePermissions,
  }
}

async function loadUserPermissions(userId: string): Promise<Permission[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      discordId: true,
      permissions: true,
      discordRolePermissions: true,
      group: { select: { name: true, permissions: true } },
      groupMemberships: { select: { group: { select: { name: true, permissions: true } } } },
    },
  })
  if (!user) return []
  const unitPerms = await loadUserUnitPermissions({ userId, discordId: user.discordId })
  const groups = user.groupMemberships.map((membership) => membership.group)
  if (user.group && !groups.some((group) => group.name === user.group?.name)) groups.push(user.group)
  return resolveEffectivePermissions(
    user.permissions,
    [
      user.discordRolePermissions,
      ...groups.map((group) => group.permissions),
      automaticPermissionsForRoleNames(groups.map((group) => group.name)),
      ...unitPerms,
    ],
  )
}

function effectiveTokenScopes(raw: unknown, userPermissions: Permission[]): Permission[] {
  const explicit = normalizePermissions(raw)
  if (explicit.length === 0) return userPermissions
  const userSet = new Set(userPermissions)
  return explicit.filter((s) => userSet.has(s))
}

function buildApiUser(
  user: { id: string; username: string; displayName: string; discordId: string | null; discordAvatar: string | null; discordDiscriminator: string | null },
  scopes: Permission[],
): CurrentUser {
  let avatarUrl: string | null = null
  if (user.discordId) {
    if (user.discordAvatar) {
      const ext = user.discordAvatar.startsWith('a_') ? 'gif' : 'png'
      avatarUrl = `https://cdn.discordapp.com/avatars/${user.discordId}/${user.discordAvatar}.${ext}?size=96`
    } else {
      const parsed = Number.parseInt(user.discordDiscriminator || '', 10)
      const idx = Number.isFinite(parsed) && parsed > 0
        ? parsed % 5
        : user.discordId.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 6
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`
    }
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    discordId: user.discordId,
    avatarUrl,
    groups: [{ id: 'api-token', name: 'API-Token' }],
    permissions: scopes,
  }
}

export async function requireAuth(allowedRoles?: string[], allowedPermissions?: Permission[]) {
  const auth = await getCurrentAuth()
  if (!auth) throw new Error('Unauthorized')
  const user = auth.user

  const hasRoles = Array.isArray(allowedRoles) && allowedRoles.length > 0
  const hasPermissions = Array.isArray(allowedPermissions) && allowedPermissions.length > 0

  if (!hasRoles && !hasPermissions) return user

  if (hasRoles) {
    const allowedLower = allowedRoles!.map((r) => String(r).toLowerCase())
    if (user.groups.some((group) => allowedLower.includes(group.name.toLowerCase()))) return user
  }

  if (hasPermissions && hasAnyPermission(user, allowedPermissions!)) return user

  throw new Error('Forbidden')
}

export async function requirePermission(permissions: Permission | Permission[]) {
  const auth = await getCurrentAuth()
  if (!auth) throw new Error('Unauthorized')
  const list = Array.isArray(permissions) ? permissions : [permissions]
  if (!hasAnyPermission(auth.user, list)) throw new Error('Forbidden')
  return auth.user
}

/**
 * Wie {@link requirePermission}, liefert aber zusätzlich den Auth-Kontext
 * (nützlich für Token-Usage-Tracking nach dem Request).
 */
export async function requireAuthContext(permissions: Permission | Permission[]) {
  const auth = await getCurrentAuth()
  if (!auth) throw new Error('Unauthorized')
  const list = Array.isArray(permissions) ? permissions : [permissions]
  if (!hasAnyPermission(auth.user, list)) throw new Error('Forbidden')
  return auth
}
