import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createMissingKummerkastenPosts, kummerkastenForum, queueKummerkastenTask } from '@/lib/kummerkasten/kummerkasten-forum'

export const dynamic = 'force-dynamic'

/** Legt für Einsendungen ohne Forum-Beitrag nachträglich einen an (im Hintergrund). */
export async function POST() {
  try {
    await requirePermission(['settings:manage', 'kummerkasten:manage'])
    if (!await kummerkastenForum()) return error('Der eingestellte Kummerkasten-Channel ist kein Forum (erst speichern)')
    queueKummerkastenTask('Forum aufbauen', async () => {
      const created = await createMissingKummerkastenPosts()
      console.log(`[Kummerkasten] ${created} fehlende Beiträge angelegt`)
    })
    return success({ started: true })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Forum konnte nicht aufgebaut werden'
    if (message === 'Unauthorized') return error('Nicht angemeldet', 401)
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
