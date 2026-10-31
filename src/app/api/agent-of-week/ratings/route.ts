import type { NextRequest } from 'next/server'

import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { agentOfWeekFailure, listAgentWeeklyRatings } from '@/lib/agents/agent-of-week-server'

export const dynamic = 'force-dynamic'

/** Einzelbewertungen eines Agents in der laufenden Woche – nur für die Verwaltung. */
export async function GET(request: NextRequest) {
  try {
    await requirePermission('agent-of-week:manage')
    const agentId = request.nextUrl.searchParams.get('agentId')
    if (!agentId) return error('agentId fehlt')
    return success(await listAgentWeeklyRatings(agentId))
  } catch (e) {
    return agentOfWeekFailure(e)
  }
}
