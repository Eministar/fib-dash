import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { FibCodeError } from '@/lib/investigations/fib-code'
import { ImportDraftError, parseImportDraft } from '@/lib/investigations/fib-code-import'
import {
  DuplicateImportError,
  createInvestigationFromImport,
  fibCodeErrorStatus,
  verifyFibCode,
} from '@/lib/investigations/fib-code-import-server'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Legt aus einem Einsatzcode und dem vom Agenten geprüften Entwurf eine Akte an.
 * Der Code wird hier erneut verifiziert (Signatur) – von ihm zählt nur die
 * Herkunft (MDT-Akte); alle Inhalte stammen aus dem validierten Entwurf.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:manage')
    const body = (await req.json().catch(() => null)) as { code?: unknown; draft?: unknown } | null
    if (typeof body?.code !== 'string') return error('Bitte einen Einsatzcode eingeben.')

    let payload
    let draft
    try {
      payload = verifyFibCode(body.code)
      draft = parseImportDraft(body.draft)
    } catch (cause) {
      if (cause instanceof FibCodeError) return error(cause.message, fibCodeErrorStatus(cause))
      if (cause instanceof ImportDraftError) return error(cause.message, 422)
      throw cause
    }

    try {
      const created = await createInvestigationFromImport({ userId: user.id, payload, draft })
      return success(created, 201)
    } catch (cause) {
      if (cause instanceof DuplicateImportError) return error(cause.message, 409)
      if (cause instanceof ImportDraftError) return error(cause.message, 422)
      throw cause
    }
  } catch (cause) {
    return routeError(cause)
  }
}
