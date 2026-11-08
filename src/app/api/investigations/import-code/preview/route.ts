import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { FibCodeError } from '@/lib/investigations/fib-code'
import { buildImportDraft, importSourceKey } from '@/lib/investigations/fib-code-import'
import {
  fibCodeErrorStatus,
  findImportedInvestigation,
  verifyFibCode,
} from '@/lib/investigations/fib-code-import-server'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/** Prüft einen Einsatzcode und liefert den Entwurf für die Vorschau – speichert nichts. */
export async function POST(req: NextRequest) {
  try {
    await requirePermission('investigations:manage')
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null
    if (typeof body?.code !== 'string') return error('Bitte einen Einsatzcode eingeben.')

    let payload
    try {
      payload = verifyFibCode(body.code)
    } catch (cause) {
      if (cause instanceof FibCodeError) return error(cause.message, fibCodeErrorStatus(cause))
      throw cause
    }

    const sourceKey = importSourceKey(payload)
    return success({
      draft: buildImportDraft(payload),
      meta: {
        caseId: payload.src.caseId,
        affiliation: payload.case.affiliation,
        issuedAt: new Date(payload.iat * 1000).toISOString(),
        issuerName: payload.issuer.name,
        issuerBadge: payload.issuer.badge,
        duplicateOf: await findImportedInvestigation(sourceKey),
      },
    })
  } catch (cause) {
    return routeError(cause)
  }
}
