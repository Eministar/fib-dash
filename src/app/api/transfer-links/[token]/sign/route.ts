import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { success, error, notFound } from '@/lib/api-response'
import { getCurrentUser } from '@/lib/auth'
import { hasPermission } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { normalizeLinkToken } from '@/lib/link-tokens'
import { cleanContractLongText, cleanContractText, readContractFields, validateContractValues } from '@/lib/contracts'
import {
  deriveTransferStatus,
  loadTransferRequestByToken,
  serializeTransferRequest,
  transferRequestSelect,
  type TransferRequestRecord,
} from '@/lib/transfer-request-service'
import { SIGNATURE_ROLE_META, isSignatureRole, type SignatureRole } from '@/lib/transfer-requests'

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || req.headers.get('x-real-ip') || '').slice(0, 64) || null
}

function alreadySigned(request: TransferRequestRecord, role: SignatureRole) {
  if (role === 'HR') return Boolean(request.hrSignedAt)
  if (role === 'AGENT') return Boolean(request.agentSignedAt)
  return Boolean(request.authoritySignedAt)
}

/**
 * Prüft, wer welche Unterschrift leisten darf:
 *
 * - FIB: nur mit HR-Verwaltungsrecht (angemeldet).
 * - Beamter: nur der Beamte selbst, erkannt über die hinterlegte Discord-ID.
 * - Entgegennehmende Behörde: jeder mit dem Link, auch ohne Anmeldung.
 */
async function authorizeSignature(request: TransferRequestRecord, role: SignatureRole) {
  const user = await getCurrentUser()

  if (role === 'AUTHORITY') return { user }

  if (!user) {
    return {
      error: error(
        role === 'HR'
          ? 'Für die FIB-Unterschrift ist eine Anmeldung im Dashboard nötig.'
          : 'Bitte melde dich mit deinem Discord-Account an, um als Beamter zu unterschreiben.',
        401,
      ),
    }
  }

  if (role === 'HR') {
    if (!hasPermission(user, 'hr:manage')) {
      return { error: error('Nur die Personalabteilung darf für das FIB unterschreiben.', 403) }
    }
    return { user }
  }

  if (request.signerDiscordId && user.discordId !== request.signerDiscordId) {
    return { error: error('Diese Unterschrift kann nur der Beamte selbst leisten.', 403) }
  }

  return { user }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token: rawToken } = await params
    const token = normalizeLinkToken(rawToken)
    if (!token) return notFound('Versetzungsantrag')

    const request = await loadTransferRequestByToken(token)
    if (!request) return notFound('Versetzungsantrag')

    if (request.status === 'CANCELLED') return error('Dieser Antrag wurde zurückgezogen.', 409)

    const body = await req.json() as Record<string, unknown>

    // Ablehnen ist ein eigener Weg — sonst bliebe ein „ich unterschreibe nicht“
    // ein ewig offener Antrag.
    if (body.action === 'decline') {
      const authorized = await authorizeSignature(request, 'AGENT')
      if ('error' in authorized) return authorized.error

      const reason = cleanContractLongText(body.reason, 1000)
      const declined = await prisma.transferRequest.update({
        where: { id: request.id },
        data: { status: 'DECLINED', declinedAt: new Date(), declineReason: reason || null },
        select: transferRequestSelect,
      })

      await createAuditLog({
        action: 'TRANSFER_REQUEST_DECLINED',
        userId: authorized.user?.id ?? null,
        agentId: request.agentId ?? undefined,
        newValue: 'DECLINED',
        details: `${request.requestNumber}${reason ? ` · ${reason}` : ''}`,
      })

      return success(serializeTransferRequest(declined))
    }

    if (request.status === 'DECLINED') {
      return error('Dieser Antrag wurde abgelehnt und kann nicht unterschrieben werden.', 409)
    }

    if (!isSignatureRole(body.role)) return error('Unbekanntes Unterschriftsfeld')
    const role = body.role

    if (alreadySigned(request, role)) {
      return error(`„${SIGNATURE_ROLE_META[role].title}“ wurde bereits geleistet.`, 409)
    }

    const authorized = await authorizeSignature(request, role)
    if ('error' in authorized) return authorized.error
    const user = authorized.user

    const signedName = cleanContractText(body.name, 120)
    if (signedName.length < 3) {
      return error('Bitte unterschreibe mit deinem vollständigen Namen.')
    }

    // Der Beamte unterschreibt den ausgefüllten Antrag — deshalb werden hier die
    // Pflichtfelder geprüft. Die anderen beiden zeichnen das Dokument nur ab.
    let values: Prisma.InputJsonValue | undefined
    if (role === 'AGENT') {
      const fields = readContractFields(request.fields)
      const validated = validateContractValues(fields, body.values ?? request.values)
      if (validated.errors.length > 0) return error(validated.errors.join(' '))
      values = validated.values as unknown as Prisma.InputJsonValue
    }

    const now = new Date()
    const signatureData: Prisma.TransferRequestUpdateInput = role === 'HR'
      ? {
          hrSignedName: signedName,
          hrSignedAt: now,
          hrSignedBy: user ? { connect: { id: user.id } } : undefined,
        }
      : role === 'AGENT'
        ? {
            agentSignedName: signedName,
            agentSignedAt: now,
            agentSignedBy: user ? { connect: { id: user.id } } : undefined,
            ...(values ? { values } : {}),
          }
        : {
            authoritySignedName: signedName,
            authoritySignedRole: cleanContractText(body.authorityRole, 160) || null,
            authoritySignedAt: now,
            authoritySignedIp: clientIp(req),
          }

    const signed = await prisma.transferRequest.update({
      where: { id: request.id },
      data: signatureData,
      select: transferRequestSelect,
    })

    // Status nachziehen, damit die HR-Übersicht ohne Neuberechnung stimmt.
    const nextStatus = deriveTransferStatus(signed)
    const final = nextStatus === signed.status
      ? signed
      : await prisma.transferRequest.update({
          where: { id: signed.id },
          data: { status: nextStatus },
          select: transferRequestSelect,
        })

    await createAuditLog({
      action: 'TRANSFER_REQUEST_SIGNED',
      userId: user?.id ?? null,
      agentId: request.agentId ?? undefined,
      newValue: signedName,
      details: `${request.requestNumber} · ${SIGNATURE_ROLE_META[role].title}`,
    })

    return success(serializeTransferRequest(final))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
