import { NextRequest } from 'next/server'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { normalizeLinkToken } from '@/lib/contracts'
import {
  loadContractLinkByToken,
  resolveSignatureAccess,
  serializeContractDocument,
  serializeParties,
} from '@/lib/contract-links'

/**
 * Vertragslink.
 *
 * **Wer den Link hat, sieht den Vertrag.** Ein Login ist nicht nötig — weder
 * für einen Arbeitsvertrag noch für eine externe Behörde. Besteht zufällig
 * eine Session, wird sie nur noch dafür benutzt, HR beim Blick in einen
 * fremden Vertrag auf Leserechte zu setzen.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Vertrag')

    const link = await loadContractLinkByToken(token)
    if (!link) return notFound('Vertrag')

    const access = await resolveSignatureAccess(
      link.signature,
      link.contract.agent?.discordId ?? null,
      await getCurrentUser(),
    )

    const document = await serializeContractDocument(link.contract, link.signature, access)
    return success({ ...document, parties: serializeParties(link.signature, link.siblings) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
