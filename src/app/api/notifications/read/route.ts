import { NextRequest } from 'next/server'

import { error, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { markNotificationsRead } from '@/lib/notifications-server'

export const dynamic = 'force-dynamic'

/** Markiert `{ ids: string[] }` oder `{ all: true }` als gelesen. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body: unknown = await req.json().catch(() => null)
    const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

    if (raw.all === true) return success({ marked: await markNotificationsRead(user, 'all') })

    if (!Array.isArray(raw.ids) || raw.ids.length === 0 || raw.ids.length > 100) {
      return error('Ungültige Auswahl')
    }
    const ids = raw.ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 191)
    if (ids.length !== raw.ids.length) return error('Ungültige Auswahl')

    return success({ marked: await markNotificationsRead(user, ids) })
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    return error(message, 500)
  }
}
