import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { clockOutByAdmin, DutyClockError } from '@/lib/manual-duty'

/** Leitung stempelt einen Agent im manuellen Modus aus. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const user = await requirePermission('duty-times:manage')
    const { agentId } = await params
    const closed = await clockOutByAdmin(agentId, user.displayName)
    return success({ sessionId: closed.id, clockOutAt: closed.clockOutAt })
  } catch (e: unknown) {
    if (e instanceof DutyClockError) return error(e.message, e.status)
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
