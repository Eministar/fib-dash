import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, forbidden } from '@/lib/api-response'
import {
  createApiToken,
  listApiTokens,
  countActiveTokensForUser,
  assertCanCreateToken,
} from '@/lib/api-tokens'
import { PERMISSIONS, type Permission, hasAnyPermission } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { getApiTokensMaxPerUser } from '@/lib/settings-helpers'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissionMode: z.enum(['auto', 'custom']).optional(),
  scopes: z.array(z.enum(PERMISSIONS as unknown as [Permission, ...Permission[]])).optional().default([]),
  expiresAt: z.string().datetime().nullable().optional(),
  /** Admin-only: User-ID, für die der Token angelegt wird. Leer = self. */
  userId: z.string().optional(),
})

export async function GET() {
  try {
    const user = await requireAuth(undefined, ['users:manage', 'groups:manage'])
    const tokens = await listApiTokens({ userId: user.id })
    const maxPerUser = await getApiTokensMaxPerUser()
    return success(
      {
        maxPerUser,
        tokens: tokens.map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.prefix,
          scopes: t.scopes,
          expiresAt: t.expiresAt,
          revokedAt: t.revokedAt,
          lastUsedAt: t.lastUsedAt,
          usageCount: t.usageCount,
          createdAt: t.createdAt,
        })),
      },
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(undefined, ['users:manage', 'groups:manage'])
    const body = await req.json().catch(() => ({}))
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return error(parsed.error.issues.map((i) => i.message).join(', '))
    }

    const { name, permissionMode, scopes, expiresAt, userId: targetUserIdRaw } = parsed.data
    const tokenScopes = permissionMode === 'auto' ? [] : scopes
    const isAdmin = hasAnyPermission(user, ['users:manage'])

    if (permissionMode === 'custom' && tokenScopes.length === 0) {
      return error('Wähle mindestens einen Scope oder verwende Auto Perm.')
    }

    // Wenn ein userId übergeben wird: nur Admins dürfen das, und der Ziel-User
    // muss existieren. Andernfalls gehört der Token dem Aufrufer.
    let targetUserId = user.id
    let targetDisplayName: string | null = null
    let targetPermissions: Permission[] = user.permissions
    if (targetUserIdRaw && targetUserIdRaw !== user.id) {
      if (!isAdmin) {
        return error('Nur Administratoren dürfen Tokens für andere Benutzer anlegen.', 403)
      }
      const target = await prisma.user.findUnique({
        where: { id: targetUserIdRaw },
        select: { id: true, displayName: true, username: true, permissions: true },
      })
      if (!target) return error('Ziel-Benutzer nicht gefunden', 404)
      targetUserId = target.id
      targetDisplayName = target.displayName
      // Scopes werden gegen die Rechte des Inhabers validiert, nicht des Erstellers.
      const targetGroupPerms = await prisma.userGroupMembership.findMany({
        where: { userId: target.id },
        select: { group: { select: { permissions: true } } },
      })
      const { resolveEffectivePermissions } = await import('@/lib/permissions')
      targetPermissions = resolveEffectivePermissions(target.permissions, targetGroupPerms.map((m) => m.group.permissions))
    }

    // Subset-Check: Token-Scopes dürfen nicht mehr Rechte enthalten als der Inhaber hat.
    if (tokenScopes.length > 0) {
      const permSet = new Set(targetPermissions)
      const invalid = tokenScopes.filter((s) => !permSet.has(s))
      if (invalid.length > 0) {
        return error(
          `Token-Scopes müssen eine Teilmenge der Inhaber-Rechte sein. Ungültig: ${invalid.join(', ')}`,
        )
      }
    }

    // Limit-Check
    const maxPerUser = await getApiTokensMaxPerUser()
    await assertCanCreateToken(targetUserId, maxPerUser)

    const { record, plaintext } = await createApiToken({
      name,
      userId: targetUserId,
      createdById: targetUserId === user.id ? null : user.id,
      scopes: tokenScopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })

    const currentCount = await countActiveTokensForUser(targetUserId)
    const limitText = maxPerUser === null ? '∞' : `${currentCount}/${maxPerUser}`

    await createAuditLog({
      action: 'API_TOKEN_CREATED',
      userId: user.id,
      newValue: record.name,
      details:
        targetUserId === user.id
          ? `Eigener Token · ${limitText} · ${tokenScopes.length > 0 ? `Scopes: ${tokenScopes.join(', ')}` : 'Auto Perm'}`
          : `Token für ${targetDisplayName ?? targetUserId} erstellt · ${limitText} · ${tokenScopes.length > 0 ? `Scopes: ${tokenScopes.join(', ')}` : 'Auto Perm'}`,
    })

    return success(
      {
        id: record.id,
        name: record.name,
        prefix: record.prefix,
        plaintext,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        ownerUserId: targetUserId,
        ownerDisplayName: targetDisplayName,
        maxPerUser,
        currentCount,
      },
      201,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    if (msg.includes('Unique constraint')) return error('Token-Konflikt', 409)
    return error(msg, 500)
  }
}
