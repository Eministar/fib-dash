import { NextRequest } from 'next/server'

import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import {
  getApplicationFormConfig,
  saveApplicationFormConfig,
} from '@/lib/job-application-settings'

export async function GET() {
  try {
    await requirePermission(['hr:view', 'hr:manage'])
    return success(await getApplicationFormConfig())
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requirePermission('hr:manage')
    const body = await req.json()
    return success(await saveApplicationFormConfig(body))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
