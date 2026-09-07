import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, forbidden, notFound } from '@/lib/api-response'
import { findApiTokenById, revokeApiToken } from '@/lib/api-tokens'
import { createAuditLog } from '@/lib/audit'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireAuth(undefined, ['users:manage', 'groups:manage'])
    const { id } = await ctx.params
    const token = await findApiTokenById(id)
    if (!token) return notFound('API-Token')
    if (token.userId !== user.id) return forbidden()

    const lastUsages = await prisma.apiTokenUsage.findMany({
      where: { tokenId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return success({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      scopes: token.scopes,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      lastUsedAt: token.lastUsedAt,
      usageCount: token.usageCount,
      createdAt: token.createdAt,
      recentUsage: lastUsages.map((u) => ({
        method: u.method,
        path: u.path,
        statusCode: u.statusCode,
        durationMs: u.durationMs,
        ip: u.ip,
        createdAt: u.createdAt,
      })),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireAuth(undefined, ['users:manage', 'groups:manage'])
    const { id } = await ctx.params
    const token = await findApiTokenById(id)
    if (!token) return notFound('API-Token')
    if (token.userId !== user.id) return forbidden()

    const url = new URL(req.url)
    const hardDelete = url.searchParams.get('hard') === '1'

    if (hardDelete) {
      await prisma.apiToken.delete({ where: { id } })
      await createAuditLog({
        action: 'API_TOKEN_HARD_DELETED',
        userId: user.id,
        details: `Token "${token.name}" (${token.prefix}) endgültig gelöscht`,
      })
      return success({ deleted: true })
    }

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason : undefined

    await revokeApiToken(id, reason)
    await createAuditLog({
      action: 'API_TOKEN_REVOKED',
      userId: user.id,
      details: `Token "${token.name}" (${token.prefix}) widerrufen${reason ? ` · Grund: ${reason}` : ''}`,
    })
    return success({ revoked: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
