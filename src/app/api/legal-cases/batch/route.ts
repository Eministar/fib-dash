import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { createLegalCaseBatch } from '@/lib/legal-case-service'

/**
 * Erzeugt für alle gekündigten Mitarbeiter mit offenen Sanktionen eine
 * Sammelklage. Liefert den geteilten Übersichtslink der Sammelklage zurück.
 */
export async function POST() {
  try {
    const user = await requirePermission('lad:manage')
    const batch = await createLegalCaseBatch(user.id)

    await createAuditLog({
      action: 'LEGAL_CASE_BATCH_CREATED',
      userId: user.id,
      newValue: batch?.token ?? '',
      details: batch ? `${batch.title} · ${batch.caseCount} Klagen` : 'Sammelklage',
    })

    return success(batch, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 400)
  }
}
