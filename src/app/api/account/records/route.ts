import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { listAgentRecords } from '@/lib/agent-records'
import { findAgentForUser } from '@/lib/manual-duty'

/** Eigene Akten-Einträge des angemeldeten Agents (nur lesend). */
export async function GET() {
  try {
    const user = await requireAuth()
    const agent = await findAgentForUser(user)
    if (!agent) return success({ linked: false, entries: [], positive: 0, negative: 0 })
    return success({ linked: true, ...(await listAgentRecords(agent.id)) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }
}
