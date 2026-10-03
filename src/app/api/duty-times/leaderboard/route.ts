import type { NextRequest } from 'next/server'

import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getDutyLeaderboard, isLeaderboardPeriod } from '@/lib/duty-times'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'

export async function GET(request: NextRequest) {
  try {
    await requirePermission('duty-times:view')
    const period = request.nextUrl.searchParams.get('period') ?? 'month'
    if (!isLeaderboardPeriod(period)) return error('Unbekannter Zeitraum', 400)
    const board = await getDutyLeaderboard(period)
    const avatarUrls = await resolveAgentAvatarUrls(board.rows)
    return success({
      ...board,
      rows: board.rows.map((row) => ({ ...row, avatarUrl: agentAvatarUrl(row, avatarUrls) })),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
