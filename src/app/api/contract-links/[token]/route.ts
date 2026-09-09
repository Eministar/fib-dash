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
 * Bei einem Arbeitsvertrag gewährt der Link allein keinen Zugriff: entweder
 * gehört der eingeloggte Discord-Account zum Vertrag (dann darf er
 * unterschreiben), oder er hat eine Prüfrolle bzw. HR-Recht (dann nur
 * Einsicht). Ohne Login wird bewusst 401 mit Kontext geliefert, damit die Seite
 * einen Discord-Login-Button zeigen kann statt einer nackten Fehlermeldung.
 *
 * Bei einer externen Behörde gibt es keinen Account, an dem sich das festmachen
 * ließe — dort ist der Besitz des Links der Nachweis.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Vertrag')

    const link = await loadContractLinkByToken(token)
    if (!link) return notFound('Vertrag')

    const user = await getCurrentUser()
    const access = await resolveSignatureAccess(
      link.signature,
      link.contract.agent?.discordId ?? null,
      user,
    )
    if (!access.ok) return error(access.message, access.status)

    const document = await serializeContractDocument(link.contract, link.signature, access.access)
    return success({ ...document, parties: serializeParties(link.signature, link.siblings) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
