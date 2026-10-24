import { z } from 'zod'
import { error, success } from '@/lib/api-response'
import { DesktopAuthError, redeemConnectCode } from '@/lib/desktop/desktop-auth'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

const schema = z
  .object({
    code: z.string().min(1).max(2000),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    deviceName: z.string().trim().min(1).max(60),
  })
  .strict()

/** Tauscht Code + PKCE-Verifier gegen den API-Token der Desktop-App. Ohne Session. */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return error('Ungültige Anfrage der Desktop-App')
    const { code, verifier, deviceName } = parsed.data
    return success({ token: await redeemConnectCode(code, verifier, deviceName) })
  } catch (cause) {
    if (cause instanceof DesktopAuthError) return error(cause.message, 400)
    return routeError(cause)
  }
}
