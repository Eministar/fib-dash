import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { findBlacklistedBadgeNumber } from '@/lib/badge-blacklist'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { normalizeBadgeNumber } from '@/lib/badge-number'

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const rows = await prisma.badgeBlacklist.findMany({ orderBy: { badgeNumber: 'asc' } })
    return success(rows)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['ranks:manage'])
    const body = await req.json()
    const inputBadgeNumber = typeof body.badgeNumber === 'string' ? body.badgeNumber.trim() : ''
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
    if (!inputBadgeNumber) return error('Dienstnummer ist erforderlich')

    const prefix = await getBadgePrefix()
    const badgeNumber = normalizeBadgeNumber(inputBadgeNumber, prefix)
    const blocked = await findBlacklistedBadgeNumber(badgeNumber, prefix)
    if (blocked) return error('Dienstnummer ist bereits gesperrt')

    const row = await prisma.badgeBlacklist.create({
      data: { badgeNumber, reason },
    })
    return success(row, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Dienstnummer ist bereits gesperrt')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
