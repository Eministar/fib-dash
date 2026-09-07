import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  PROBATION_TYPE_LABELS,
  defaultChecklistForProbationType,
  probationStatus,
  probationType,
  type ProbationTypeValue,
} from '@/lib/probations'

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeChecklist(value: unknown, type: ProbationTypeValue) {
  if (!Array.isArray(value)) return defaultChecklistForProbationType(type)
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

export async function GET(req: NextRequest) {
  try {
    await requirePermission('probations:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const status = probationStatus((req.nextUrl.searchParams.get('status') || '').toUpperCase())
  const type = probationType((req.nextUrl.searchParams.get('type') || '').toUpperCase())
  const probations = await prisma.probation.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    include: {
      agent: { include: { rank: true } },
      createdBy: { select: { displayName: true } },
      decidedBy: { select: { displayName: true } },
      entries: {
        include: { createdBy: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ status: 'asc' }, { type: 'asc' }, { endsAt: 'asc' }],
  })

  return success(probations)
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('probations:manage')
    const body = await req.json()
    const agentId = cleanText(body.agentId)
    const rawType = cleanText(body.type)
    const type = rawType ? probationType(rawType.toUpperCase()) : 'ROOKIE'
    const startsAt = parseDate(body.startsAt) ?? new Date()
    const endsAt = parseDate(body.endsAt)

    if (!agentId) return error('Agent ist erforderlich')
    if (!type) return error('Probezeit-Typ ist ungültig')
    if (!endsAt) return error('Probezeit-Enddatum ist erforderlich')
    if (endsAt < startsAt) return error('Probezeit-Ende darf nicht vor dem Start liegen')
    const checklist = normalizeChecklist(body.checklist, type)

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { rank: true },
    })
    if (!agent) return error('Agent nicht gefunden', 404)
    if (agent.status === 'TERMINATED') return error('Gekündigte Agents können keine aktive Probezeit erhalten')

    const existingActive = await prisma.probation.findFirst({
      where: { agentId, type, status: 'ACTIVE' },
      select: { id: true },
    })
    if (existingActive) return error('Für diesen Agent ist dieser Probezeit-Typ bereits aktiv')

    const probation = await prisma.probation.create({
      data: {
        agentId,
        type,
        startsAt,
        endsAt,
        checklist,
        status: 'ACTIVE',
        createdById: user.id,
      },
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
      action: 'PROBATION_STARTED',
      userId: user.id,
      agentId,
      details: `${PROBATION_TYPE_LABELS[type]}: ${agent.firstName} ${agent.lastName} bis ${endsAt.toLocaleDateString('de-DE')}`,
    })

    return success(probation, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
