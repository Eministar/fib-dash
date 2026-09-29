import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getDutyMode } from '@/lib/duty-mode'
import { setDutyMode } from '@/lib/manual-duty'

function failure(e: unknown) {
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function GET() {
  try {
    await requireAuth(['ADMIN'], ['settings:manage'])
    return success({ mode: await getDutyMode() })
  } catch (e: unknown) {
    return failure(e)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN'], ['settings:manage'])
    const parsed = z.object({ mode: z.enum(['api', 'manual']) }).safeParse(await req.json())
    if (!parsed.success) return error('Ungültiger Modus')
    const result = await setDutyMode(parsed.data.mode, user.displayName)
    return success({ mode: parsed.data.mode, ...result })
  } catch (e: unknown) {
    return failure(e)
  }
}
