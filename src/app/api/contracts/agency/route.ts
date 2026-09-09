import { NextRequest } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { contractSelect } from '@/lib/contract-service'
import { createAgencyContract } from '@/lib/contract-signature-service'
import { sanitizeContractClauses, sanitizeContractFields } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

const clauseSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  body: z.string().max(20000),
  sortOrder: z.number().int().default(0),
})

const schema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich').max(200),
    content: z.string().max(20000).default(''),
    clauses: z.array(clauseSchema).max(60).default([]),
    closing: z.string().max(20000).nullish(),
    fields: z.array(z.unknown()).max(40).default([]),
    templateId: z.string().trim().max(64).nullish(),

    ownPartyName: z.string().trim().min(1, 'Eigene Vertretung ist erforderlich').max(200),
    ownPartyRole: z.string().trim().max(200).nullish(),
    /** Wer auf unserer Seite unterschreiben darf. Ohne Angabe genügt der Link. */
    ownSignerDiscordId: z.string().trim().max(64).nullish(),

    counterpartyName: z.string().trim().min(1, 'Name der Gegenpartei ist erforderlich').max(200),
    counterpartyRole: z.string().trim().max(200).nullish(),
  })
  .strict()

/**
 * Legt einen Vertrag mit einer externen Behörde an.
 *
 * Bewusst eine eigene Route: `POST /api/contracts` trägt Agent-spezifische
 * Logik — Bewerbungsbezug, Discord-Versand und den Schutz gegen einen zweiten
 * offenen Vertrag je Agent. Nichts davon passt hier.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('contracts:manage')
    const body = schema.parse(await req.json())

    if (body.templateId) {
      const template = await prisma.contractTemplate.findUnique({
        where: { id: body.templateId },
        select: { id: true },
      })
      if (!template) return error('Vorlage nicht gefunden', 404)
    }

    const contract = await createAgencyContract({
      title: body.title,
      content: body.content,
      clauses: sanitizeContractClauses(body.clauses),
      closing: body.closing?.trim() || null,
      fields: sanitizeContractFields(body.fields),
      templateId: body.templateId ?? null,
      ownParty: {
        partyName: body.ownPartyName,
        partyRole: body.ownPartyRole ?? null,
        signerDiscordId: body.ownSignerDiscordId ?? null,
      },
      counterparty: {
        partyName: body.counterpartyName,
        partyRole: body.counterpartyRole ?? null,
      },
      createdById: user.id,
    })

    await createAuditLog({
      action: 'CONTRACT_CREATED',
      userId: user.id,
      newValue: contract.title,
      details: `Behördenvertrag mit ${body.counterpartyName}`,
    })

    const full = await prisma.contract.findUnique({ where: { id: contract.id }, select: contractSelect })
    return success(full, 201)
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return error(e.issues.map((issue) => issue.message).join(' '))
    }
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 400)
  }
}
