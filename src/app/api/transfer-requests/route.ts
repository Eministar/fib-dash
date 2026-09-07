import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { cleanContractText } from '@/lib/contracts'
import { resolveBaseUrl, transferRequestUrl } from '@/lib/site'
import {
  createTransferRequest,
  deriveTransferStatus,
  transferRequestSelect,
  transferSignatures,
} from '@/lib/transfer-request-service'

function toListRow(request: Awaited<ReturnType<typeof createTransferRequest>>, baseUrl: string) {
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    token: request.token,
    url: transferRequestUrl(baseUrl, request.token),
    title: request.title,
    agentId: request.agentId,
    agentName: request.agentName,
    badgeNumber: request.badgeNumber,
    rankName: request.rankName,
    targetAuthority: request.targetAuthority,
    status: deriveTransferStatus(request),
    signatures: transferSignatures(request),
    declineReason: request.declineReason,
    createdBy: request.createdBy,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission(['hr:view', 'contracts:view'])
    const baseUrl = resolveBaseUrl(req)

    const requests = await prisma.transferRequest.findMany({
      orderBy: { createdAt: 'desc' },
      select: transferRequestSelect,
      take: 300,
    })

    return success(requests.map((request) => toListRow(request, baseUrl)))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('hr:manage')
    const body = await req.json() as Record<string, unknown>

    const agentId = cleanContractText(body.agentId, 40)
    if (!agentId) return error('Bitte wähle einen Agent aus')

    const request = await createTransferRequest({
      agentId,
      title: cleanContractText(body.title, 160),
      targetAuthority: cleanContractText(body.targetAuthority, 160),
      createdById: user.id,
    })

    await createAuditLog({
      action: 'TRANSFER_REQUEST_CREATED',
      userId: user.id,
      agentId,
      newValue: request.requestNumber,
      details: request.targetAuthority ?? request.title,
    })

    return success(toListRow(request, resolveBaseUrl(req)), 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
