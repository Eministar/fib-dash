import { getCurrentUser } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { aiStatus } from '@/lib/ai/ai-server'

/** Ob der KI-Knopf angezeigt wird. Der Key selbst verlässt nie den Server. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  return success(await aiStatus())
}
