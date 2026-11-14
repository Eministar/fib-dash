import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { routeError } from '@/lib/investigations/investigations-server'
import { getLaws } from '@/lib/laws/laws'

export const dynamic = 'force-dynamic'

/**
 * Gesetzbuch für Picker und Anzeige, live vom FJD (zwischengespeichert).
 * `?fresh=1` lädt sofort neu, z. B. direkt nach einer neuen Bekanntmachung.
 */
export async function GET(req: Request) {
  try {
    await requirePermission('investigations:view')
    const fresh = new URL(req.url).searchParams.get('fresh') === '1'
    const laws = await getLaws({ fresh })
    return success({
      source: laws.source,
      syncedAt: laws.syncedAt,
      origin: laws.origin,
      laws: laws.laws.map((law) => ({ abbr: law.abbr, name: law.name, group: law.group, status: law.status, url: law.url })),
      norms: laws.norms,
    })
  } catch (cause) {
    return routeError(cause)
  }
}
