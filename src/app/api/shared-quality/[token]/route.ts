import { success } from '@/lib/api-response'
import { normalizeLinkToken } from '@/lib/link-tokens'
import { publicShareHeaders } from '@/lib/record-shares'
import { publicShareOverview, qcRouteError, resolveQcShare } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Öffentliche Übersicht einer Qualitäts-Freigabe – ohne Login, nur lesend. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const share = await resolveQcShare(normalizeLinkToken((await params).token))
    return publicShareHeaders(success(await publicShareOverview(share)))
  } catch (cause) {
    return publicShareHeaders(qcRouteError(cause))
  }
}
