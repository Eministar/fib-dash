import { NextRequest } from 'next/server'

import { error, success, unauthorized } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { LspdUnavailableError, getLspdOfficerFile } from '@/lib/lspd-hr-client'

export const dynamic = 'force-dynamic'

/** LSPD-Beamtenakte (Stammdaten + Laufbahn). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    return success(await getLspdOfficerFile(id))
  } catch (cause) {
    if (cause instanceof LspdUnavailableError) return error(cause.message, cause.status)
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    return error(message, 500)
  }
}
