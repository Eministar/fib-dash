import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { syncAgentOfWeekRole, syncDiscordAgentOfWeekBoard } from '@/lib/discord/discord-integration'
import { agentOfWeekFailure, closeFinishedWeeks } from '@/lib/agents/agent-of-week-server'

/** Board sofort neu schreiben – schließt vorher offene Wochen ab und gleicht die Rolle ab. */
export async function POST() {
  try {
    await requirePermission('settings:manage')
    await closeFinishedWeeks()
    await syncAgentOfWeekRole()
    const result = await syncDiscordAgentOfWeekBoard({ force: true })
    if (result.skipped) return error('Agent-der-Woche-Channel oder Discord-Bot ist nicht konfiguriert', 409)
    return success(result)
  } catch (cause) { return agentOfWeekFailure(cause) }
}
