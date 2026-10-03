import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'
import {
  AgentOfMonthError,
  castAgentOfMonthVote,
  getAgentOfMonthState,
  withdrawAgentOfMonthVote,
} from '@/lib/agent-of-month-server'

const voteSchema = z.object({ agentId: z.string().min(1) })

function failure(e: unknown) {
  if (e instanceof AgentOfMonthError) return error(e.message, e.status)
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

async function state(user: { id: string; discordId: string | null }) {
  const data = await getAgentOfMonthState(user)
  const avatarUrls = await resolveAgentAvatarUrls(data.winners)
  return { ...data, winners: data.winners.map((agent) => ({ ...agent, avatarUrl: agentAvatarUrl(agent, avatarUrls) })) }
}

export async function GET() {
  try {
    const user = await requireAuth()
    return success(await state(user))
  } catch (e) {
    return failure(e)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth()
    const parsed = voteSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return error('Ungültige Daten')
    await castAgentOfMonthVote(user, parsed.data.agentId)
    return success(await state(user))
  } catch (e) {
    return failure(e)
  }
}

export async function DELETE() {
  try {
    const user = await requireAuth()
    await withdrawAgentOfMonthVote(user.id)
    return success(await state(user))
  } catch (e) {
    return failure(e)
  }
}
