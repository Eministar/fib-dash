import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '../prisma'
import {
  normalizePermissions,
  type Permission,
} from '../permissions'
import type { CurrentUser } from '../auth'

export const API_TOKEN_PREFIX = 'fib_'
export const API_TOKEN_BYTES = 32
export const API_TOKEN_PEEK_LENGTH = 10

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

export function buildPlaintextToken(secret: string): string {
  return `${API_TOKEN_PREFIX}${secret}`
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

export interface AuthenticatedApiContext {
  token: ApiTokenRecord
  scopes: Permission[]
  user: CurrentUser
}

export interface RequestLike {
  headers: { get(name: string): string | null }
  cookies?: { get(name: string): { value: string } | undefined }
}

