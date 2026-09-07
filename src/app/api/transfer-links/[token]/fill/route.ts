import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { success, error, notFound } from '@/lib/api-response'
import { normalizeLinkToken } from '@/lib/link-tokens'
import { readContractFields, readContractValues } from '@/lib/contracts'
import {
  loadTransferRequestByToken,
  serializeTransferRequest,
  transferRequestSelect,
} from '@/lib/transfer-request-service'

/**
 * Antragsfelder speichern. Bewusst ohne Anmeldung: den Antrag füllt der Beamte
 * über denselben Link aus, den auch die Behörde bekommt.
 *
 * Gesperrt wird, sobald der Beamte unterschrieben hat — ein gezeichnetes
 * Dokument darf sich nicht mehr ändern.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Versetzungsantrag')

    const request = await loadTransferRequestByToken(token)
    if (!request) return notFound('Versetzungsantrag')

    if (request.status === 'CANCELLED') {
      return error('Dieser Antrag wurde zurückgezogen.', 409)
    }
    if (request.status === 'DECLINED') {
      return error('Dieser Antrag wurde abgelehnt.', 409)
    }
    if (request.agentSignedAt) {
      return error('Der Antrag wurde bereits vom Beamten unterschrieben und kann nicht mehr geändert werden.', 409)
    }

    const body = await req.json() as Record<string, unknown>
    const fields = readContractFields(request.fields)

    // Beim Zwischenspeichern wird bewusst NICHT auf Pflichtfelder geprüft —
    // das passiert erst beim Unterschreiben.
    const incoming = readContractValues(body.values)
    const values: Record<string, string | boolean> = {}
    for (const field of fields) {
      const raw = incoming[field.id]
      if (field.type === 'CHECKBOX') {
        values[field.id] = raw === true || raw === 'true'
        continue
      }
      const maxLength = field.type === 'LONG_TEXT' ? 4000 : 200
      values[field.id] = typeof raw === 'string' ? raw.slice(0, maxLength) : ''
    }

    const updated = await prisma.transferRequest.update({
      where: { id: request.id },
      data: {
        values: values as unknown as Prisma.InputJsonValue,
        // Die Zielbehörde steht auch im Kopf des Dokuments.
        targetAuthority: typeof values.ziel_behoerde === 'string' && values.ziel_behoerde.trim()
          ? values.ziel_behoerde.trim().slice(0, 160)
          : request.targetAuthority,
      },
      select: transferRequestSelect,
    })

    return success(serializeTransferRequest(updated))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
