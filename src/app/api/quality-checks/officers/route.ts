import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { qcRouteError, qualityOfficerStats } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Kennzahlen je kontrolliertem LSPD-Beamten (Anzahl, Bewertungen, letzte Kontrolle). */
export async function GET() {
  try {
    await requirePermission('quality-checks:view')
    return success(await qualityOfficerStats())
  } catch (cause) {
    return qcRouteError(cause)
  }
}
