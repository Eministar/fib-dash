import { success } from '@/lib/api-response'
import { normalizeLinkToken } from '@/lib/link-tokens'
import { publicShareHeaders } from '@/lib/record-shares'
import { publicShareOfficer, qcRouteError, resolveQcShare } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Beamtenakte innerhalb einer Freigabe: abgeschlossene Kontrollen, optional LSPD-Laufbahn. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; lspdId: string }> }) {
  try {
    const { token, lspdId } = await params
    const share = await resolveQcShare(normalizeLinkToken(token))
    return publicShareHeaders(success(await publicShareOfficer(share, lspdId)))
  } catch (cause) {
    return publicShareHeaders(qcRouteError(cause))
  }
}
