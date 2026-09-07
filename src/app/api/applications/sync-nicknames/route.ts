import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { refreshApplicantIdentity, type NicknameSyncStatus } from '@/lib/application-identity'

/**
 * Bewerbungen pro Aufruf. Bewusst klein: Discord limitiert Nickname-Änderungen,
 * und ein Request, der minutenlang offen steht, überlebt keinen Proxy. Der
 * Client ruft so lange nach, bis `remaining` auf 0 steht.
 */
const DEFAULT_BATCH = 20
const MAX_BATCH = 50

function emptyCounts(): Record<NicknameSyncStatus, number> {
  return { synced: 0, skipped: 0, 'not-member': 0, 'missing-permissions': 0, failed: 0 }
}

/**
 * Wer umbenannt wird: jeder Bewerber mit Discord-Konto, der noch nicht
 * eingestellt ist.
 *
 * Bereits eingestellte Bewerber bleiben bewusst außen vor — deren Nickname
 * gehört dem Agent-Sync (Dienstnummer + Name). Würden beide Systeme
 * schreiben, überschriebe sich der Name bei jedem Lauf gegenseitig.
 */
const PENDING_WHERE = {
  discordId: { not: '' },
  agentId: null,
  nicknameSyncedAt: null,
} as const

/**
 * Benennt alle Bewerber auf „Aktenzeichen | Vorname Nachname“ um — im Dashboard
 * und auf Discord. Läuft in Häppchen und merkt sich pro Bewerbung den Versuch,
 * damit ein zweiter Durchgang nicht von vorne anfängt.
 *
 * `force: true` ignoriert die Markierung und nimmt wirklich alle erneut dran.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('hr:manage')

    let body: Record<string, unknown> = {}
    try {
      body = await req.json() as Record<string, unknown>
    } catch {
      body = {}
    }

    const force = body.force === true
    const requested = Number(body.limit)
    const batchSize = Number.isFinite(requested) && requested > 0
      ? Math.min(MAX_BATCH, Math.trunc(requested))
      : DEFAULT_BATCH

    // `force` setzt die Markierungen zurück, statt den Filter zu umgehen —
    // so bleibt „noch offen“ auch im erzwungenen Lauf eine ehrliche Zahl und
    // der Client kann bis 0 durchlaufen.
    if (force) {
      await prisma.jobApplication.updateMany({
        where: { discordId: { not: '' }, agentId: null },
        data: { nicknameSyncedAt: null },
      })
    }

    const applications = await prisma.jobApplication.findMany({
      where: PENDING_WHERE,
      orderBy: { submittedAt: 'asc' },
      select: { id: true },
      take: batchSize,
    })

    const counts = emptyCounts()

    // Sequenziell: `refreshApplicantIdentity` markiert jede Bewerbung als
    // versucht, auch wenn Discord die Umbenennung ablehnt.
    for (const application of applications) {
      const result = await refreshApplicantIdentity(application.id)
      if (result) counts[result.nickname] += 1
    }

    const remaining = await prisma.jobApplication.count({ where: PENDING_WHERE })

    if (applications.length > 0) {
      await createAuditLog({
        action: 'APPLICATION_NICKNAMES_SYNCED',
        userId: user.id,
        newValue: String(counts.synced),
        details: `${applications.length} Bewerbungen verarbeitet, ${remaining} offen`,
      })
    }

    return success({ processed: applications.length, remaining, counts })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

/** Wie viele Bewerber noch auf ihre Umbenennung warten. */
export async function GET() {
  try {
    await requirePermission('hr:manage')

    const [total, pending] = await Promise.all([
      prisma.jobApplication.count({ where: { discordId: { not: '' }, agentId: null } }),
      prisma.jobApplication.count({ where: PENDING_WHERE }),
    ])

    return success({ total, pending })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
