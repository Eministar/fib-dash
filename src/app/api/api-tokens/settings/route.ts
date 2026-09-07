import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, forbidden } from '@/lib/api-response'
import { getApiTokensMaxPerUser } from '@/lib/settings-helpers'
import { createAuditLog } from '@/lib/audit'

const updateSchema = z.object({
  /**
   * - `unlimited` / `0` / `-1` → keine Begrenzung
   * - positive Ganzzahl → diese Anzahl
   */
  maxPerUser: z.union([z.literal('unlimited'), z.number().int().positive().max(10000), z.literal(0), z.literal(-1)]),
})

export async function GET() {
  try {
    await requireAuth(undefined, ['users:manage', 'groups:manage'])
    return success({ maxPerUser: await getApiTokensMaxPerUser() })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN'])
    const body = await req.json().catch(() => ({}))
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return error(parsed.error.issues.map((i) => i.message).join(', '))

    const value = parsed.data.maxPerUser === 'unlimited' || parsed.data.maxPerUser === 0 || parsed.data.maxPerUser === -1
      ? 'unlimited'
      : String(parsed.data.maxPerUser)

    await prisma.systemSetting.upsert({
      where: { key: 'apiTokensMaxPerUser' },
      create: { key: 'apiTokensMaxPerUser', value },
      update: { value },
    })

    await createAuditLog({
      action: 'API_TOKENS_LIMIT_UPDATED',
      userId: user.id,
      newValue: value,
      details: `Token-Limit pro Benutzer geändert auf: ${value === 'unlimited' ? 'unbegrenzt' : value}`,
    })

    return success({ maxPerUser: await getApiTokensMaxPerUser() })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
