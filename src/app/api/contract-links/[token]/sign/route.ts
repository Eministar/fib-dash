import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordHrEvent } from '@/lib/discord-integration'
import { loadContractByToken, serializeContractDocument } from '@/lib/contract-links'
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
 * Unterschreiben darf ausschließlich der Agent selbst. Prüfrollen und HR
 * haben über denselben Link nur Leserecht — sie dürfen hier also nicht durch.
 *
 * Die Discord-ID wird gegen den Vertrags-Snapshot UND gegen die aktuelle
 * Agent-Akte geprüft. So bleibt die Unterschrift auch dann möglich, wenn HR
 * die Discord-ID nach Erstellung des Vertrags korrigiert hat.
 */
async function authorizeSigner(token: string) {
  const contract = await loadContractByToken(token)
  if (!contract) return { error: notFound('Vertrag') }

  const user = await getCurrentUser()
  if (!user) {
    return { error: error('Bitte melde dich mit Discord an, um zu unterschreiben.', 401) }
  }

  const signerDiscordId = contract.signerDiscordId?.trim() || null
  const agentDiscordId = contract.agent?.discordId?.trim() || null
  if (!signerDiscordId && !agentDiscordId) {
    return { error: error('Für diesen Vertrag ist keine Discord-ID hinterlegt.', 409) }
  }

  const ownsContract = Boolean(user.discordId && (
    (signerDiscordId && user.discordId === signerDiscordId) ||
    (agentDiscordId && user.discordId === agentDiscordId)
  ))
  if (!ownsContract) {
    return {
      error: error('Nur der Agent selbst kann diesen Vertrag unterschreiben.', 403),
    }
  }

  return { contract, user }
}

/** Bestimmt den aktuell gültigen Discord-Signierungs-Snapshot für den Vertrag. */
function contractSignerDiscordId(contract: Awaited<ReturnType<typeof loadContractByToken>>) {
  return contract?.agent?.discordId?.trim() || contract?.signerDiscordId?.trim() || null
}

/** Vertrag ausfüllen und unterschreiben. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Vertrag')

    const authorized = await authorizeSigner(token)
    if ('error' in authorized) return authorized.error
    const { contract, user } = authorized

    if (contract.status === 'SIGNED') {
      return error('Dieser Vertrag wurde bereits unterschrieben.', 409)
    }
    if (contract.status === 'CANCELLED') {
      return error('Dieser Vertrag wurde zurückgezogen. Bitte melde dich bei der Personalabteilung.', 409)
    }

    const body = await req.json()

    // Ablehnen ist ein eigener, bewusst dokumentierter Weg — sonst würde ein
    // „ich unterschreibe nicht“ nur als ewig offener Vertrag erscheinen.
    if (body.action === 'decline') {
      const reason = cleanContractLongText(body.reason, 1000)
      const declined = await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: 'DECLINED',
          declinedAt: new Date(),
          declineReason: reason || null,
        },
        select: { id: true, agentId: true, title: true },
      })

      await createAuditLog({
        action: 'CONTRACT_DECLINED',
        userId: user.id,
        agentId: declined.agentId ?? undefined,
        oldValue: contract.status,
        newValue: 'DECLINED',
        details: reason || declined.title,
      })

      const updated = await loadContractByToken(token)
      return success(updated ? await serializeContractDocument(updated) : null)
    }

    const fields = readContractFields(contract.fields)
    const { values, errors } = validateContractValues(fields, body.values)
    if (errors.length > 0) return error(errors.join(' '))

    const signatureField = primarySignatureField(fields)
    const signedName = signatureField ? String(values[signatureField.id] ?? '').trim() : ''
    if (signatureField && !signedName) {
      return error('Bitte unterschreibe mit deinem vollständigen Namen.')
    }

    const signed = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'SIGNED',
        values: values as unknown as Prisma.InputJsonValue,
        signedAt: new Date(),
        // Ein Behoerdenvertrag hat keinen Agent; dann traegt allein das
        // Unterschriftsfeld den Namen.
        signedName:
          signedName ||
          [contract.agent?.firstName, contract.agent?.lastName].filter(Boolean).join(' ').trim() ||
          null,
        signerDiscordId: contractSignerDiscordId(contract),
        signedByUserId: user.id,
        signedIp: clientIp(req),
        signedUserAgent: req.headers.get('user-agent')?.slice(0, 200) ?? null,
        declinedAt: null,
        declineReason: null,
      },
      select: {
        id: true,
        agentId: true,
        title: true,
        signedName: true,
        agent: {
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
        },
      },
    })

    await createAuditLog({
      action: 'CONTRACT_SIGNED',
      userId: user.id,
      agentId: signed.agentId ?? undefined,
      newValue: signed.signedName ?? '',
      details: signed.title,
    })

    // Die HR-Meldung gilt Arbeitsvertraegen. Ein Behoerdenvertrag hat keinen
    // Agent, ueber den sie berichten koennte.
    if (signed.agent) {
      queueDiscordHrEvent({
        type: 'update',
        title: 'Arbeitsvertrag unterschrieben',
        agent: signed.agent,
        description: `${signed.title} wurde von ${signed.signedName} unterschrieben.`,
      })
    }

    const updated = await loadContractByToken(token)
    return success(updated ? await serializeContractDocument(updated) : null)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
