import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { investigationForum, queueForumTask, rebuildInvestigationForum } from '@/lib/investigation-forum'

export const dynamic = 'force-dynamic'

/**
 * Forum aufbauen: legt fehlende Beiträge an und aktualisiert vorhandene. Läuft
 * im Hintergrund, weil Discord das Anlegen vieler Beiträge drosselt.
 */
export async function POST() {
  try {
    await requirePermission('settings:manage')
    if (!await investigationForum()) return error('Der eingestellte Ermittlungs-Channel ist kein Forum (erst speichern)')
    queueForumTask('Forum aufbauen', async () => {
      const result = await rebuildInvestigationForum()
      console.log(`[InvestigationForum] Aufgebaut: ${result.investigations} laufende Akten, ${result.dossiers} Dauerakten`)
    })
    return success({ started: true })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Forum konnte nicht aufgebaut werden'
    if (message === 'Unauthorized') return error('Nicht angemeldet', 401)
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
