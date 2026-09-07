import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { PROBATION_STATUS_LABELS, PROBATION_TYPE_LABELS, probationStatus, probationType } from '@/lib/probations'

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeChecklist(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>
      return {
        id: cleanText(row.id) || cleanText(row.label).toLowerCase().replace(/\s+/g, '-'),
        label: cleanText(row.label),
        completed: row.completed === true,
      }
    })
    .filter((item) => item.id && item.label)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('probations:manage')
    const { id } = await params
    const body = await req.json()
    const existing = await prisma.probation.findUnique({ where: { id }, include: { agent: true } })
    if (!existing) return notFound('Probezeit')

    const data: Record<string, unknown> = {}
    let nextType = existing.type
    let nextStatus = existing.status
    if ('startsAt' in body) {
      const startsAt = parseDate(body.startsAt)
      if (!startsAt) return error('Startdatum ist ungültig')
      data.startsAt = startsAt
    }
    if ('endsAt' in body) {
      const endsAt = parseDate(body.endsAt)
      if (!endsAt) return error('Enddatum ist ungültig')
      data.endsAt = endsAt
    }
    if ('checklist' in body) {
      const checklist = normalizeChecklist(body.checklist)
      if (!checklist) return error('Checkliste ist ungültig')
      data.checklist = checklist
    }
    if ('type' in body) {
      const type = probationType(cleanText(body.type).toUpperCase())
      if (!type) return error('Probezeit-Typ ist ungültig')
      data.type = type
      nextType = type
    }
    if ('status' in body) {
      const status = probationStatus(cleanText(body.status).toUpperCase())
      if (!status) return error('Probezeit-Status ist ungültig')
      data.status = status
      nextStatus = status
      data.resultNote = cleanText(body.resultNote) || null
      if (status === 'ACTIVE') {
        data.decidedAt = null
        data.decidedById = null
      } else {
        data.decidedAt = new Date()
        data.decidedById = user.id
      }
    }

    const nextStart = data.startsAt instanceof Date ? data.startsAt : existing.startsAt
    const nextEnd = data.endsAt instanceof Date ? data.endsAt : existing.endsAt
    if (nextEnd < nextStart) return error('Probezeit-Ende darf nicht vor dem Start liegen')

    if (nextStatus === 'ACTIVE') {
      const duplicateActive = await prisma.probation.findFirst({
        where: {
          id: { not: id },
          agentId: existing.agentId,
          type: nextType,
          status: 'ACTIVE',
        },
        select: { id: true },
      })
      if (duplicateActive) return error('Für diesen Agent ist dieser Probezeit-Typ bereits aktiv')
    }

    const probation = await prisma.probation.update({
      where: { id },
      data,
      include: {
        agent: { include: { rank: true } },
        createdBy: { select: { displayName: true } },
        decidedBy: { select: { displayName: true } },
        entries: {
          include: { createdBy: { select: { displayName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    await createAuditLog({
      action: 'PROBATION_UPDATED',
      userId: user.id,
      agentId: probation.agentId,
      details: `${probation.agent.firstName} ${probation.agent.lastName}: ${PROBATION_TYPE_LABELS[probation.type]} / ${PROBATION_STATUS_LABELS[probation.status]}`,
    })

    return success(probation)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('probations:manage')
    const { id } = await params
    const probation = await prisma.probation.findUnique({ where: { id }, include: { agent: true } })
    if (!probation) return notFound('Probezeit')
    await prisma.probation.delete({ where: { id } })
    await createAuditLog({
      action: 'PROBATION_DELETED',
      userId: user.id,
      agentId: probation.agentId,
      details: `${probation.agent.firstName} ${probation.agent.lastName}`,
    })
    return success({ message: 'Probezeit gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
