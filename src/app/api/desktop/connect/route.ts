import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { error, success } from '@/lib/api-response'
import { isValidChallenge, issueConnectCode } from '@/lib/desktop/desktop-auth'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

const schema = z.object({ challenge: z.string() }).strict()

/** Bestätigung auf `/desktop-connect`: stellt den kurzlebigen Code für die App aus. */
export async function POST(req: Request) {
  try {
    const user = await requireAuth()
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success || !isValidChallenge(parsed.data.challenge)) return error('Ungültige Anfrage der Desktop-App')
    return success({ code: issueConnectCode(user.id, parsed.data.challenge) })
  } catch (cause) {
    return routeError(cause)
  }
}
