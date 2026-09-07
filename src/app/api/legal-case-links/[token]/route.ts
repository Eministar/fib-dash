import { NextRequest } from 'next/server'
import { success, error, notFound } from '@/lib/api-response'
import { normalizeLinkToken } from '@/lib/link-tokens'
import {
  loadLegalCaseByToken,
  serializeLegalCase,
} from '@/lib/legal-case-service'

/**
 * Geteilter Klageschrift-Link.
 *
 * Bewusst ohne Anmeldung: jeder, der den Link hat, darf die Klageschrift
 * einsehen — analog zum Versetzungsantrag handelt es sich um ein Dokument
 * mit begrenzter Verbreitung, das über den Token geschützt ist.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Klageschrift')

    const legalCase = await loadLegalCaseByToken(token)
    if (!legalCase) return notFound('Klageschrift')

    return success(await serializeLegalCase(legalCase))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
