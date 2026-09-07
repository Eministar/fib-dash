import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { syncDiscordAbsenceStatusMessage } from '@/lib/discord-integration'

export async function POST() {
  try {
    await requirePermission('settings:manage')
    await syncDiscordAbsenceStatusMessage({ forceCreate: true })
    return success({ message: 'Discord-Abmeldungen aktualisiert' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
