import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agents/agent-avatar'
import { MAX_SCORE, MIN_SCORE } from '@/lib/agents/agent-of-week'
import { agentOfWeekFailure, getAgentOfWeekState, saveAgentWeeklyRating } from '@/lib/agents/agent-of-week-server'
import { queueAgentOfWeekBoardUpdate } from '@/lib/discord/discord-integration'

export const dynamic = 'force-dynamic'

const score = z.number().int().min(MIN_SCORE).max(MAX_SCORE)
const ratingSchema = z.object({ agentId: z.string().min(1), shooting: score, work: score, activity: score, roleplay: score })

async function state(user: { id: string; discordId: string | null; permissions?: string[] | null }) {
  const data = await getAgentOfWeekState(user, {
    canRate: hasPermission(user, 'agent-of-week:rate'),
    canManage: hasPermission(user, 'agent-of-week:manage'),
  })
  const avatarUrls = await resolveAgentAvatarUrls([
    ...data.ranking.map((row) => row.agent),
    ...(data.winners?.agents.flatMap((row) => row.agent ? [row.agent] : []) ?? []),
  ])
  return {
    ...data,
    ranking: data.ranking.map((row) => ({ ...row, agent: { ...row.agent, avatarUrl: agentAvatarUrl(row.agent, avatarUrls) } })),
    winners: data.winners && {
      ...data.winners,
      agents: data.winners.agents.map((row) => ({ ...row, agent: row.agent && { ...row.agent, avatarUrl: agentAvatarUrl(row.agent, avatarUrls) } })),
    },
  }
}

export async function GET() {
  try {
    const user = await requirePermission('agent-of-week:view')
    return success(await state(user))
  } catch (e) {
    return agentOfWeekFailure(e)
  }
}

/** Eigene Bewertung eines Agents für die laufende Woche anlegen oder ändern. */
export async function PUT(request: NextRequest) {
  try {
    const user = await requirePermission('agent-of-week:rate')
    const parsed = ratingSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return error(`Ungültige Bewertung – jede Kategorie braucht eine Note von ${MIN_SCORE} bis ${MAX_SCORE}.`)
    const { agentId, ...scores } = parsed.data
    await saveAgentWeeklyRating(user, agentId, scores)
    queueAgentOfWeekBoardUpdate()
    return success(await state(user))
  } catch (e) {
    return agentOfWeekFailure(e)
  }
}
