import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { contractSelect } from '@/lib/contract-service'
import { cleanContractLongText } from '@/lib/contracts'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(['contracts:view', 'contracts:manage'])
    const { id } = await params

    const contract = await prisma.contract.findUnique({ where: { id }, select: contractSelect })
    if (!contract) return notFound('Vertrag')

    return success(contract)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('contracts:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, agentId: true },
    })
    if (!existing) return notFound('Vertrag')
    if (existing.status === 'SIGNED') {
      return error('Ein unterschriebener Vertrag kann nicht mehr geändert werden')
    }

    // Bewusst eng gehalten: HR darf einen offenen Vertrag zurückziehen oder
    // wieder aktivieren — Inhalt und Felder bleiben als Snapshot unveränderlich.
    if (body.action !== 'cancel' && body.action !== 'reopen') {
      return error('Unbekannte Aktion')
    }

    const contract = await prisma.contract.update({
      where: { id },
      data: body.action === 'cancel'
        ? {
            status: 'CANCELLED',
            declineReason: cleanContractLongText(body.reason, 1000) || null,
          }
        : { status: 'DRAFT', declinedAt: null, declineReason: null },
      select: contractSelect,
    })

    await createAuditLog({
      action: body.action === 'cancel' ? 'CONTRACT_CANCELLED' : 'CONTRACT_REOPENED',
      userId: user.id,
      agentId: existing.agentId,
      oldValue: existing.status,
      newValue: contract.status,
      details: contract.title,
    })

    return success(contract)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('contracts:manage')
    const { id } = await params

    const contract = await prisma.contract.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, agentId: true },
    })
    if (!contract) return notFound('Vertrag')
    if (contract.status === 'SIGNED') {
      return error('Ein unterschriebener Vertrag kann nicht gelöscht werden')
    }

    await prisma.contract.delete({ where: { id } })
    await createAuditLog({
      action: 'CONTRACT_DELETED',
      userId: user.id,
      agentId: contract.agentId,
      oldValue: contract.title,
    })

    return success({ deleted: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
