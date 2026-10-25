import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { grantLicenseToAllActive, LicenseError } from '@/lib/licenses/licenses-server'

/** Erstausstattung: Lizenz allen Agents im Dienst erteilen, die sie noch nie hatten. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN'], ['licenses:manage'])
    const { id } = await params
    return success(await grantLicenseToAllActive(id, user))
  } catch (e: unknown) {
    if (e instanceof LicenseError) return error(e.message)
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
