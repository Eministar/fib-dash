import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { syncDiscordCodenameBoard } from '@/lib/discord-integration'
import { codenameRouteError } from '@/lib/codename-route-error'

export async function POST() {
  try {
    await requirePermission('settings:manage')
    const result = await syncDiscordCodenameBoard()
    if (result.skipped) return error('Decknamen-Channel oder Discord-Bot ist nicht konfiguriert', 409)
    return success(result)
  } catch (cause) { return codenameRouteError(cause) }
}
