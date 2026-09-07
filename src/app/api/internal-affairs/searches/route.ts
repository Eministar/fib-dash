import { NextRequest } from 'next/server'

import { createAuditLog } from '@/lib/audit'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const searchInclude = {
  createdBy: { select: { id: true, displayName: true } },
} as const

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('internal-affairs:view')
    const agentId = req.nextUrl.searchParams.get('agentId')?.trim()
    if (!agentId) return error('Agent-ID ist erforderlich')

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        status: true,
        rank: { select: { id: true, name: true, color: true } },
        searches: {
          include: searchInclude,
          orderBy: [{ conductedAt: 'desc' }, { createdAt: 'desc' }],
        },
      },
    })
    if (!agent) return notFound('Agent')

    return success(agent)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('internal-affairs:manage')
    const body = await req.json()
    const agentId = cleanText(body.agentId)
    const conductedAt = parseDate(body.conductedAt)
    if (!agentId) return error('Agent ist erforderlich')
    if (agentId.length > 191) return error('Agent-ID ist ungültig')
    if (!conductedAt) return error('Datum und Uhrzeit sind ungültig')
    if (conductedAt.getTime() > Date.now() + 5 * 60_000) return error('Die Durchsuchung darf nicht in der Zukunft liegen')
    if (body.prohibitedItemsFound !== true && body.prohibitedItemsFound !== false) {
      return error('Bitte angeben, ob verbotene Gegenstände gefunden wurden')
    }
    const foundItems = cleanText(body.foundItems)
    const notes = cleanText(body.notes)
    if (foundItems.length > 10_000 || notes.length > 10_000) return error('Der Eintrag ist zu lang')
    if (body.prohibitedItemsFound && !foundItems) return error('Bitte die verbotenen Gegenstände auflisten')

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, firstName: true, lastName: true, badgeNumber: true, status: true },
    })
    if (!agent) return notFound('Agent')
    if (agent.status === 'TERMINATED') return error('Für gekündigte Agents können keine neuen Durchsuchungen erfasst werden')

    const entry = await prisma.agentSearch.create({
      data: {
        agentId,
        conductedAt,
        prohibitedItemsFound: body.prohibitedItemsFound,
        foundItems,
        notes: notes || null,
        createdById: user.id,
      },
      include: searchInclude,
    })

    await createAuditLog({
      action: 'AGENT_SEARCH_CREATED',
      userId: user.id,
      agentId,
      details: `${agent.firstName} ${agent.lastName} · ${body.prohibitedItemsFound ? 'Verbotene Gegenstände gefunden' : 'Keine verbotenen Gegenstände'}`,
    })

    return success(entry, 201)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
