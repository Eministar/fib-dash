import { NextRequest } from 'next/server'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { normalizeLinkToken } from '@/lib/contracts'
import {
  loadContractByToken,
  resolveContractAccess,
  serializeContractDocument,
} from '@/lib/contract-links'

/**
 * Vertragslink.
 *
 * Der Link allein gewährt keinen Zugriff: entweder gehört der eingeloggte
 * Discord-Account zum Vertrag (dann darf er unterschreiben), oder er hat eine
 * Prüfrolle bzw. HR-Recht (dann nur Einsicht). Ohne Login wird bewusst 401 mit
 * Kontext geliefert, damit die Seite einen Discord-Login-Button zeigen kann
 * statt einer nackten Fehlermeldung.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Vertrag')

    const contract = await loadContractByToken(token)
    if (!contract) return notFound('Vertrag')

    const user = await getCurrentUser()
    const access = await resolveContractAccess(contract, user)
    if (!access.ok) return error(access.message, access.status)

    return success(await serializeContractDocument(contract, access.access))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
