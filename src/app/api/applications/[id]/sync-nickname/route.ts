import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { refreshApplicantIdentity } from '@/lib/application-identity'

/**
 * Setzt Anzeigename und Discord-Nickname des Bewerbers neu auf
 * „Aktenzeichen | Vorname Nachname“. Gedacht für Bewerbungen, die ihr
 * Aktenzeichen nachträglich bekommen haben, und als Reparaturknopf, wenn
 * Discord die Umbenennung beim Einreichen verweigert hat.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('hr:manage')
    const { id } = await params

    const result = await refreshApplicantIdentity(id)
    if (!result) return notFound('Bewerbung')

    return success(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
