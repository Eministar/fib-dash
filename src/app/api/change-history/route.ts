import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { getChangeHistoryStatus } from '@/lib/change-history'

export async function GET() {
  try {
    const user = await requireAuth()
    return success(await getChangeHistoryStatus(user.id))
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    return error(message, 500)
  }
}
