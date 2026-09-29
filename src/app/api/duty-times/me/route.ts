import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { getDutyMode, DUTY_ACTIVITY_RESPONSE_MS } from '@/lib/duty-mode'
import { clockIn, clockOut, confirmDutyActivity, DutyClockError, findAgentForUser, getOpenDutySession } from '@/lib/manual-duty'

async function state(user: { id: string; discordId: string | null }) {
  const mode = await getDutyMode()
  const agent = await findAgentForUser(user)
  const session = agent && mode === 'manual' ? await getOpenDutySession(agent.id) : null
  return {
    mode,
    linked: !!agent,
    session: session && {
      id: session.id,
      clockInAt: session.clockInAt,
      activityCheckDeadline: session.activityCheckSentAt
        ? new Date(session.activityCheckSentAt.getTime() + DUTY_ACTIVITY_RESPONSE_MS)
        : null,
    },
  }
}

function failure(e: unknown) {
  if (e instanceof DutyClockError) return error(e.message, e.status)
  const msg = e instanceof Error ? e.message : 'Serverfehler'
  if (msg === 'Unauthorized') return unauthorized()
  if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
  return error(msg, 500)
}

export async function GET() {
  try {
    const user = await requireAuth()
    return success(await state(user))
  } catch (e: unknown) {
    return failure(e)
  }
}

const body = z.object({
  action: z.enum(['clock-in', 'clock-out', 'confirm']),
  sessionId: z.string().max(191).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const input = body.parse(await req.json())
    const agent = await findAgentForUser(user)
    if (!agent) return error('Dein Konto ist mit keinem aktiven Agent verknüpft.', 403)

    if (input.action === 'clock-in') await clockIn(agent.id, 'dashboard', user.discordId)
    else if (input.action === 'clock-out') await clockOut(agent.id, 'dashboard')
    else {
      if (!input.sessionId) return error('Session fehlt')
      await confirmDutyActivity(input.sessionId, agent.id)
    }
    return success(await state(user))
  } catch (e: unknown) {
    if (e instanceof z.ZodError) return error('Ungültige Anfrage')
    return failure(e)
  }
}
