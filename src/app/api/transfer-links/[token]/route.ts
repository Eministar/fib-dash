import { NextRequest } from 'next/server'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/permissions'
import { normalizeLinkToken } from '@/lib/link-tokens'
import { loadTransferRequestByToken, serializeTransferRequest } from '@/lib/transfer-request-service'

/**
 * Versetzungsantrag über den geteilten Link.
 *
 * Bewusst ohne Anmeldezwang: die entgegennehmende Behörde hat keinen Account im
 * Dashboard. Wer eingeloggt ist, bekommt zusätzlich mitgeteilt, welche der drei
 * Unterschriften er selbst leisten darf.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Versetzungsantrag')

    const request = await loadTransferRequestByToken(token)
    if (!request) return notFound('Versetzungsantrag')

    const user = await getCurrentUser()
    const isAgent = Boolean(
      request.signerDiscordId
        ? user?.discordId && user.discordId === request.signerDiscordId
        : Boolean(user),
    )

    return success({
      ...serializeTransferRequest(request),
      viewer: {
        loggedIn: Boolean(user),
        displayName: user?.displayName ?? null,
        canSignHr: hasPermission(user, 'hr:manage'),
        canSignAgent: isAgent,
        // Die entgegennehmende Behörde zeichnet ohne Account — jeder mit dem
        // Link darf hier unterschreiben.
        canSignAuthority: true,
        canDecline: isAgent,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
