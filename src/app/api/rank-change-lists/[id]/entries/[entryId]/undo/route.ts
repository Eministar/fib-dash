import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { undoPromotionListEntry } from '@/lib/rank-change-list-undo'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['rank-change-lists:execute'])
    const { id, entryId } = await params

    const result = await undoPromotionListEntry(id, entryId, user)
    if (!result.ok) return error(result.message, result.status)
    return success(result.data)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Discord-ID bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
