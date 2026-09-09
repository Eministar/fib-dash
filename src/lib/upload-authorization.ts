import { requireAuth, requirePermission } from './auth'
import { requireTaskModuleManage } from './module-permissions'
import type { UploadKind } from './upload-sessions'

/**
 * Genau die Berechtigung, die auch die jeweilige fachliche Route verlangt —
 * an der Quelle nachgeschlagen, damit Transport und Einlösen nicht
 * auseinanderlaufen:
 *
 * - Clips   `src/app/api/investigations/clips/route.ts`      → investigations:manage
 * - Fotos   `src/app/api/investigations/photos/upload/route.ts` → investigations:manage
 * - Asservate `src/app/api/corruption-checks/[id]/evidence/route.ts` → nur Anmeldung
 * - Ressourcen `src/app/api/academy/resources/route.ts`      → Modul ACADEMY verwalten
 *
 * Bewusst getrennt von `upload-sessions.ts`: dieses Modul zieht `next/headers`
 * nach, der Kern des Transports soll ohne Next-Laufzeit testbar bleiben.
 */
export async function authorizeUploadKind(kind: UploadKind) {
  if (kind === 'RESOURCE') return requireTaskModuleManage('ACADEMY')
  if (kind === 'EVIDENCE') return requireAuth()
  return requirePermission('investigations:manage')
}
