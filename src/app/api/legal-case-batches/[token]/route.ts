import { NextRequest } from 'next/server'
import { success, error, notFound } from '@/lib/api-response'
import { normalizeLinkToken } from '@/lib/link-tokens'
import {
  loadLegalCaseBatchByToken,
  serializeLegalCaseBatch,
} from '@/lib/legal-case-service'

/**
 * Geteilter Sammelklage-Link: Übersicht aller enthaltenen Klageschriften.
 * Bewusst ohne Anmeldung — jeder mit dem Link darf die Übersicht einsehen.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Sammelklage')

    const batch = await loadLegalCaseBatchByToken(token)
    if (!batch) return notFound('Sammelklage')

    return success(await serializeLegalCaseBatch(batch))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
