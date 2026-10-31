import type { NextRequest } from 'next/server'

import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit/audit'
import { agentOfWeekFailure, deleteAgentWeeklyRating } from '@/lib/agents/agent-of-week-server'
import { queueAgentOfWeekBoardUpdate } from '@/lib/discord/discord-integration'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** Missbräuchliche Bewertung der laufenden Woche entfernen. */
export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('agent-of-week:manage')
    const { id } = await params
    const rating = await deleteAgentWeeklyRating(id)
    await createAuditLog({ action: 'AGENT_OF_WEEK_RATING_DELETED', userId: user.id, agentId: rating.agentId, details: `Bewertung ${rating.week} gelöscht` })
    queueAgentOfWeekBoardUpdate()
    return success({ deleted: true })
  } catch (e) {
    return agentOfWeekFailure(e)
  }
}
