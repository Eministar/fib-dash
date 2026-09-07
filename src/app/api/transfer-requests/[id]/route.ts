import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { cleanContractText } from '@/lib/contracts'
import { resolveBaseUrl, transferRequestUrl } from '@/lib/site'
import {
  deriveTransferStatus,
  serializeTransferRequest,
  transferRequestSelect,
} from '@/lib/transfer-request-service'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(['hr:view', 'contracts:view'])
    const { id } = await params

    const request = await prisma.transferRequest.findUnique({ where: { id }, select: transferRequestSelect })
    if (!request) return notFound('Versetzungsantrag')

    return success({
      ...serializeTransferRequest(request),
      url: transferRequestUrl(resolveBaseUrl(req), request.token),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

/** Titel/Zielbehörde ändern oder den Antrag zurückziehen. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('hr:manage')
    const { id } = await params
    const body = await req.json() as Record<string, unknown>

    const existing = await prisma.transferRequest.findUnique({
      where: { id },
      select: { id: true, requestNumber: true, status: true },
    })
    if (!existing) return notFound('Versetzungsantrag')

    const cancel = body.action === 'cancel'
    const reopen = body.action === 'reopen'

    const updated = await prisma.transferRequest.update({
      where: { id },
      data: {
        title: 'title' in body ? cleanContractText(body.title, 160) || undefined : undefined,
        targetAuthority: 'targetAuthority' in body
          ? cleanContractText(body.targetAuthority, 160) || null
          : undefined,
        ...(cancel ? { status: 'CANCELLED' as const } : {}),
        ...(reopen ? { status: 'SENT' as const, declinedAt: null, declineReason: null } : {}),
      },
      select: transferRequestSelect,
    })

    if (cancel || reopen) {
      await createAuditLog({
        action: cancel ? 'TRANSFER_REQUEST_CANCELLED' : 'TRANSFER_REQUEST_REOPENED',
        userId: user.id,
        oldValue: existing.status,
        newValue: updated.status,
        details: existing.requestNumber,
      })
    }

    return success({
      ...serializeTransferRequest(updated),
      status: deriveTransferStatus(updated),
      url: transferRequestUrl(resolveBaseUrl(req), updated.token),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('hr:manage')
    const { id } = await params

    const existing = await prisma.transferRequest.findUnique({
      where: { id },
      select: { id: true, requestNumber: true },
    })
    if (!existing) return notFound('Versetzungsantrag')

    await prisma.transferRequest.delete({ where: { id } })

    await createAuditLog({
      action: 'TRANSFER_REQUEST_DELETED',
      userId: user.id,
      oldValue: existing.requestNumber,
    })

    return success({ id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
