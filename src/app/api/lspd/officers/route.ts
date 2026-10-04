import { NextRequest } from 'next/server'

import { error, success, unauthorized, forbidden } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { LspdUnavailableError, searchLspdOfficers } from '@/lib/lspd-hr-client'

export const dynamic = 'force-dynamic'

/** Beamtensuche im LSPD-Panel (für Auswahlfelder). Jeder Angemeldete darf suchen. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth()
    const params = req.nextUrl.searchParams
    const status = params.get('status')?.split(',').filter(Boolean)
    const officers = await searchLspdOfficers({
      q: params.get('q') ?? '',
      status,
      limit: Number.parseInt(params.get('limit') ?? '25', 10) || 25,
    })
    return success(officers)
  } catch (cause) {
    if (cause instanceof LspdUnavailableError) return error(cause.message, cause.status)
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return forbidden()
    return error(message, 500)
  }
}
