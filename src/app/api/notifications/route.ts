import { error, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { getInbox, syncProbationReminders } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

/** Inbox des angemeldeten Nutzers: die neuesten Benachrichtigungen plus Ungelesen-Zähler. */
export async function GET() {
  try {
    const user = await requireAuth()
    // Gedrosselt; läuft zusätzlich in /api/status-automation.
    void syncProbationReminders()
    return success(await getInbox(user))
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    return error(message, 500)
  }
}
