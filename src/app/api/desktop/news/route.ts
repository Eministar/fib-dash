import { getCurrentAuth } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { getDesktopAnnouncements } from '@/lib/desktop/desktop-news'
import { readDesktopReleaseHistory } from '@/lib/desktop/desktop-releases'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Seite „Neuigkeiten“ der Desktop-App: Ankündigungen aus Discord und die
 * Änderungen der letzten App-Versionen. Fällt Discord aus, kommen die
 * Versionen trotzdem – mit Fehlertext für den Ankündigungsbereich.
 */
export async function GET() {
  try {
    const auth = await getCurrentAuth()
    if (!auth) return unauthorized()

    const [releases, announcements] = await Promise.all([
      readDesktopReleaseHistory().catch(() => []),
      getDesktopAnnouncements().then(
        (data) => ({ ...data, error: null }),
        (cause: unknown) => {
          console.error('[DesktopNews] Ankündigungen konnten nicht geladen werden', cause)
          return { configured: true, announcements: [], mentions: { users: {}, roles: {}, channels: {} }, error: 'Discord ist gerade nicht erreichbar.' }
        },
      ),
    ])
    return success({ releases, ...announcements })
  } catch (cause) {
    return routeError(cause)
  }
}
