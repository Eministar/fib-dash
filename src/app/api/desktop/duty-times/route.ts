import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agents/agent-avatar'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { getDutyTimesSnapshot } from '@/lib/duty/duty-times'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Dienstzeiten für die Desktop-App: nur die Agents und ihre Zeiten, ohne
 * Bestenlisten, Einstellungen oder Discord-Nachrichten wie im Dashboard.
 * Wartet nicht auf die Player-Online-API, sondern nutzt den letzten Stand.
 */
export async function GET() {
  try {
    await requirePermission('duty-times:view')
    const snapshot = await getDutyTimesSnapshot(new Date(), { sync: false })
    const avatars = await resolveAgentAvatarUrls(snapshot.rows)
    return success({
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      agents: snapshot.rows.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        badge: displayBadgeNumber(row.badgeNumber),
        avatarUrl: agentAvatarUrl(row, avatars),
        rank: row.rank ? { name: row.rank.name, color: row.rank.color, order: row.rank.sortOrder } : null,
        onDuty: !!row.activeSession,
        dutySince: row.activeSession?.clockInAt ?? null,
        weekMs: row.weekDurationMs,
        sessionCount: row.sessionCount,
        lastSeenAt: row.lastSeenAt,
      })),
    })
  } catch (cause) {
    return routeError(cause)
  }
}
