import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordHrEvent } from '@/lib/discord-integration'
import {
  loadContractLinkByToken,
  resolveSignatureAccess,
  serializeContractDocument,
  serializeParties,
} from '@/lib/contract-links'
import { declineWithToken, signWithToken } from '@/lib/contract-signature-service'
import {
  cleanContractLongText,
  normalizeLinkToken,
  primarySignatureField,
  readContractFields,
  validateContractValues,
} from '@/lib/contracts'

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || req.headers.get('x-real-ip') || '').slice(0, 64) || null
}

/**
 * Vertrag ausfüllen und unterschreiben.
 *
 * Geschrieben wird immer in **eine** Unterschriftszeile — die, zu der der Token
 * gehört. Der Vertragsstatus ergibt sich anschließend aus allen Zeilen; bei
 * einem Behördenvertrag ist er also erst geschlossen, wenn beide Seiten
 * gezeichnet haben.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Vertrag')

    const link = await loadContractLinkByToken(token)
    if (!link) return notFound('Vertrag')

    const { contract, signature } = link
    const access = await resolveSignatureAccess(signature, contract.agent?.discordId ?? null, await getCurrentUser())
    if (!access.ok) return error(access.message, access.status)
    if (access.access !== 'signer') {
      return error('Diese Seite darf den Vertrag nur einsehen.', 403)
    }

    const user = await getCurrentUser()

    if (contract.status === 'CANCELLED') {
      return error('Dieser Vertrag wurde zurückgezogen. Bitte melde dich bei der Personalabteilung.', 409)
    }
    if (signature.signedAt) {
      return error('Diese Seite hat den Vertrag bereits unterschrieben.', 409)
    }

    const body = await req.json()

    // Ablehnen ist ein eigener, bewusst dokumentierter Weg — sonst würde ein
    // „ich unterschreibe nicht“ nur als ewig offener Vertrag erscheinen.
    if (body.action === 'decline') {
      const reason = cleanContractLongText(body.reason, 1000)
      await declineWithToken(token, reason || null)

      await createAuditLog({
        action: 'CONTRACT_DECLINED',
        userId: user?.id ?? null,
        agentId: contract.agent?.id ?? undefined,
        oldValue: contract.status,
        newValue: 'DECLINED',
        details: `${signature.partyName}: ${reason || contract.title}`,
      })

      return respond(token)
    }

    const fields = readContractFields(contract.fields)
    const { values, errors } = validateContractValues(fields, body.values)
    if (errors.length > 0) return error(errors.join(' '))

    const signatureField = primarySignatureField(fields)
    const typedName = signatureField ? String(values[signatureField.id] ?? '').trim() : ''
    if (signatureField && !typedName) {
      return error('Bitte unterschreibe mit deinem vollständigen Namen.')
    }

    // Fällt das Unterschriftsfeld weg, trägt der Agent-Name bzw. der Name der
    // Partei die Unterschrift.
    const signedName =
      typedName ||
      [contract.agent?.firstName, contract.agent?.lastName].filter(Boolean).join(' ').trim() ||
      signature.partyName

    const result = await signWithToken(token, {
      values,
      signedName,
      userId: user?.id ?? null,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
    })
    if (!result) return notFound('Vertrag')

    await createAuditLog({
      action: 'CONTRACT_SIGNED',
      userId: user?.id ?? null,
      agentId: contract.agent?.id ?? undefined,
      newValue: signedName,
      details: `${signature.partyName}: ${contract.title}`,
    })

    // Die HR-Meldung gilt Arbeitsverträgen und erst dem vollständig
    // unterschriebenen Vertrag — eine halbe Unterschrift ist keine Nachricht wert.
    if (result.status === 'SIGNED' && contract.agent) {
      const agent = await prisma.agent.findUnique({
        where: { id: contract.agent.id },
        select: {
          id: true,
          discordId: true,
          firstName: true,
          lastName: true,
          badgeNumber: true,
          status: true,
          hireDate: true,
          rankId: true,
          unit: true,
          units: true,
          promotionBlocked: true,
          rank: { select: { name: true, sortOrder: true, color: true } },
        },
      })
      if (agent) {
        queueDiscordHrEvent({
          type: 'update',
          title: 'Arbeitsvertrag unterschrieben',
          agent,
          description: `${contract.title} wurde von ${signedName} unterschrieben.`,
        })
      }
    }

    return respond(token)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}

/** Liefert das Dokument im Stand nach der Änderung zurück. */
async function respond(token: string) {
  const updated = await loadContractLinkByToken(token)
  if (!updated) return success(null)
  const document = await serializeContractDocument(updated.contract, updated.signature, 'signer')
  return success({ ...document, parties: serializeParties(updated.signature, updated.siblings) })
}
