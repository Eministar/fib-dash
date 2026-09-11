import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import {
  normalizePermissions,
  resolveEffectivePermissions,
  type Permission,
} from './permissions'
import type { CurrentUser } from './auth'

export const API_TOKEN_PREFIX = 'fib_'
export const API_TOKEN_BYTES = 32
export const API_TOKEN_PEEK_LENGTH = 10
const USAGE_WRITE_THROTTLE_MS = 60_000

export interface ApiTokenRecord {
  id: string
  name: string
  prefix: string
  userId: string
  createdById: string | null
  scopes: Permission[]
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  lastUsedAt: Date | null
  usageCount: number
}

export interface GeneratedApiToken {
  record: ApiTokenRecord
  /** Klartext-Token — nur dieses eine Mal sichtbar. */
  plaintext: string
}

function base62(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let n = BigInt('0x' + bytes.toString('hex'))
  let out = ''
  while (n > BigInt(0)) {
    out = alphabet[Number(n % BigInt(62))] + out
    n = n / BigInt(62)
  }
  return out
}

function randomTokenSecret(): string {
  return base62(randomBytes(API_TOKEN_BYTES))
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim())
  return match ? match[1] : null
}

export function buildPlaintextToken(secret: string): string {
  return `${API_TOKEN_PREFIX}${secret}`
}

export function previewToken(plaintext: string): string {
  const head = plaintext.slice(0, API_TOKEN_PEEK_LENGTH)
  return `${head}${'•'.repeat(Math.max(0, plaintext.length - API_TOKEN_PEEK_LENGTH))}`
}

function sanitizeScopes(value: unknown): Permission[] {
  return normalizePermissions(value)
}

function toApiTokenRecord(row: {
  id: string
  name: string
  prefix: string
  userId: string
  createdById: string | null
  scopes: unknown
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  lastUsedAt: Date | null
  usageCount: number
}): ApiTokenRecord {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    userId: row.userId,
    createdById: row.createdById,
    scopes: sanitizeScopes(row.scopes),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    usageCount: row.usageCount,
  }
}

export interface CreateApiTokenInput {
  name: string
  userId: string
  createdById?: string | null
  scopes?: Permission[]
  expiresAt?: Date | null
}

export async function createApiToken(input: CreateApiTokenInput): Promise<GeneratedApiToken> {
  const name = input.name.trim()
  if (!name) throw new Error('Name ist erforderlich')
  if (name.length > 80) throw new Error('Name ist zu lang (max. 80 Zeichen)')

  const secret = randomTokenSecret()
  const plaintext = buildPlaintextToken(secret)
  const prefix = plaintext.slice(0, API_TOKEN_PEEK_LENGTH)
  const tokenHash = hashToken(plaintext)

  const row = await prisma.apiToken.create({
    data: {
      name,
      prefix,
      tokenHash,
      userId: input.userId,
      createdById: input.createdById ?? null,
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
    },
  })

  return { record: toApiTokenRecord(row), plaintext }
}

export interface ListApiTokensOptions {
  userId?: string
  includeRevoked?: boolean
}

export async function listApiTokens(options: ListApiTokensOptions = {}): Promise<ApiTokenRecord[]> {
  const rows = await prisma.apiToken.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.includeRevoked ? {} : { revokedAt: null }),
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toApiTokenRecord)
}

/**
 * Zählt aktive (nicht widerrufene) Tokens eines Users.
 */
export async function countActiveTokensForUser(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { userId, revokedAt: null } })
}

/**
 * Wirft einen Error, falls das User-Limit überschritten würde.
 * `maxPerUser` = null oder 0 bedeutet "unbegrenzt".
 */
export async function assertCanCreateToken(userId: string, maxPerUser: number | null): Promise<void> {
  if (maxPerUser === null || maxPerUser === 0) return
  const current = await countActiveTokensForUser(userId)
  if (current >= maxPerUser) {
    throw new Error(
      `Token-Limit erreicht: Maximal ${maxPerUser} aktive Tokens pro Benutzer. ` +
      `Widerrufe einen bestehenden Token oder erhöhe das Limit in den Einstellungen.`,
    )
  }
}

export async function findApiTokenById(id: string): Promise<ApiTokenRecord | null> {
  const row = await prisma.apiToken.findUnique({ where: { id } })
  return row ? toApiTokenRecord(row) : null
}

export async function revokeApiToken(id: string, reason?: string): Promise<ApiTokenRecord> {
  const row = await prisma.apiToken.update({
    where: { id },
    data: {
      revokedAt: new Date(),
      revokedReason: reason?.trim() || null,
    },
  })
  return toApiTokenRecord(row)
}

export async function deleteApiToken(id: string): Promise<void> {
  await prisma.apiToken.delete({ where: { id } })
}

export interface AuthenticatedApiContext {
  token: ApiTokenRecord
  scopes: Permission[]
  user: CurrentUser
}

interface AuthenticatedResult {
  kind: 'cookie' | 'api'
  user: CurrentUser
  api?: AuthenticatedApiContext
}

export interface RequestLike {
  headers: { get(name: string): string | null }
  cookies?: { get(name: string): { value: string } | undefined }
}

function effectiveScopesForUser(token: ApiTokenRecord, userPermissions: Permission[]): Permission[] {
  if (token.scopes.length === 0) return userPermissions
  const userSet = new Set(userPermissions)
  return normalizePermissions(token.scopes).filter((scope) => userSet.has(scope))
}

/**
 * Versucht, einen eingehenden Request zu authentifizieren.
 * Reihenfolge:
 *  1. Cookie-basierte Session (Dashboard-Login)
 *  2. `Authorization: Bearer fib_…` (Public API)
 */
export async function authenticateRequest(req: RequestLike): Promise<AuthenticatedResult | null> {
  const cookieStore = await cookies()

  // 1) Cookie-Auth
  const cookieToken = cookieStore.get('auth-token')?.value
  if (cookieToken) {
    // Reuse auth.ts via getCurrentUser pattern: load user from cookie
    const cookieUser = await loadUserFromCookieToken(cookieToken)
    if (cookieUser) {
      return { kind: 'cookie', user: cookieUser }
    }
  }

  // 2) Bearer-Auth
  const bearer = extractBearerToken(req.headers.get('authorization'))
  if (bearer && bearer.startsWith(API_TOKEN_PREFIX)) {
    const tokenHash = hashToken(bearer)
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (!row || row.revokedAt) return null
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null
    if (!row.user) return null

    const userPermissions = await loadUserPermissions(row.userId)
    const scopes = effectiveScopesForUser(toApiTokenRecord(row), userPermissions)
    const apiUser = buildApiUser(row.user, scopes)
    return {
      kind: 'api',
      user: apiUser,
      api: {
        token: toApiTokenRecord(row),
        scopes,
        user: apiUser,
      },
    }
  }

  return null
}

async function loadUserFromCookieToken(token: string): Promise<CurrentUser | null> {
  // Re-uses the same logic as getCurrentUser() in auth.ts. We intentionally
  // duplicate the small "load + permissions" step here to avoid a circular
  // import between auth.ts and this module.
  const { verifyToken } = await import('./auth')
  const payload = verifyToken(token)
  if (!payload) return null
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
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
  const permissions = resolveEffectivePermissions(user.permissions, [user.discordRolePermissions, ...groups.map((g) => g.permissions)])
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    discordId: user.discordId,
    avatarUrl: buildAvatarUrl(user.discordId, user.discordAvatar, user.discordDiscriminator),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    permissions,
  }
}

async function loadUserPermissions(userId: string): Promise<Permission[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      permissions: true,
      discordRolePermissions: true,
      group: { select: { permissions: true } },
      groupMemberships: { select: { group: { select: { permissions: true } } } },
    },
  })
  if (!user) return []
  const groupPerms = user.groupMemberships.map((m) => m.group.permissions)
  return resolveEffectivePermissions(user.permissions, [user.discordRolePermissions, ...groupPerms])
}

function buildAvatarUrl(
  discordId: string | null,
  discordAvatar: string | null,
  discordDiscriminator: string | null,
): string | null {
  if (!discordId) return null
  if (discordAvatar) {
    const ext = discordAvatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${discordId}/${discordAvatar}.${ext}?size=96`
  }
  const parsed = Number.parseInt(discordDiscriminator || '', 10)
  const idx = Number.isFinite(parsed) && parsed > 0
    ? parsed % 5
    : discordId.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 6
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`
}

function buildApiUser(
  user: { id: string; username: string; displayName: string; discordId: string | null; discordAvatar: string | null; discordDiscriminator: string | null },
  scopes: Permission[],
): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    discordId: user.discordId,
    avatarUrl: buildAvatarUrl(user.discordId, user.discordAvatar, user.discordDiscriminator),
    groups: [{ id: 'api-token', name: 'API-Token' }],
    permissions: scopes,
  }
}

/**
 * Aktualisiert lastUsedAt throttled, damit der DB-Write pro Request nicht
 * zur Last wird. Läuft fire-and-forget nach erfolgreichem Auth.
 */
export async function trackApiTokenUsage(tokenId: string): Promise<void> {
  try {
    const row = await prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: { lastUsedAt: true },
    })
    if (!row) return
    const now = new Date()
    if (row.lastUsedAt && now.getTime() - row.lastUsedAt.getTime() < USAGE_WRITE_THROTTLE_MS) {
      // Nur Counter inkrementieren — günstig und ohne Konflikt.
      await prisma.apiToken.update({
        where: { id: tokenId },
        data: { usageCount: { increment: 1 } },
      })
      return
    }
    await prisma.apiToken.update({
      where: { id: tokenId },
      data: { lastUsedAt: now, usageCount: { increment: 1 } },
    })
  } catch {
    // Tracking-Fehler dürfen den eigentlichen Request nie blockieren.
  }
}

export function hasApiScope(auth: AuthenticatedApiContext, permission: Permission): boolean {
  return auth.scopes.includes(permission)
}

export function hasAnyApiScope(auth: AuthenticatedApiContext, permissions: Permission[]): boolean {
  return permissions.some((p) => auth.scopes.includes(p))
}
