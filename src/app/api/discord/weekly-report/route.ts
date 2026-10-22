import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { getDiscordConfig } from '@/lib/discord-integration'
import { sendWeeklyReport } from '@/lib/weekly-report-server'

export const dynamic = 'force-dynamic'

/** Sendet den Bericht der Vorwoche sofort – zum Prüfen; der Montagslauf bleibt unberührt. */
export async function POST() {
  try {
    await requirePermission('settings:manage')
    const config = await getDiscordConfig()
    if (!config.weeklyReportChannelId) return error('Kein Channel für den Wochenbericht eingestellt (erst speichern)')
    const data = await sendWeeklyReport(config.weeklyReportChannelId)
    return success({ week: data.window.key })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Wochenbericht konnte nicht gesendet werden'
    if (message === 'Unauthorized') return error('Nicht angemeldet', 401)
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
