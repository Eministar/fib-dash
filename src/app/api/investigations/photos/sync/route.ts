import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import { syncInvestigationPhotos } from '@/lib/investigation-photos'

export async function POST() {
  try {
    await requirePermission('settings:manage')
    const result = await syncInvestigationPhotos()
    return result.configured ? success(result) : error('Bitte zuerst den Bilder-Channel in den Discord-Einstellungen auswählen.', 409)
  } catch (cause) { return routeError(cause) }
}
