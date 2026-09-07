import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { queueDiscordInvestigationEvent } from '@/lib/discord-integration'
import { prisma } from '@/lib/prisma'
import {
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
  investigationListInclude,
  investigationVisibilityWhere,
  isInvestigationPriority,
  isInvestigationStatus,
  serializeBigInts,
} from '@/lib/investigations'
import {
  agentDisplayName,
  cleanText,
  nextInvestigationCaseNumber,
  routeError,
} from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:view')
    const { searchParams } = req.nextUrl

    const status = searchParams.get('status')?.trim()
    const priority = searchParams.get('priority')?.trim()
    const personId = searchParams.get('personId')?.trim()
    const search = searchParams.get('search')?.trim()

    const filters: Prisma.InvestigationWhereInput[] = [investigationVisibilityWhere(user)]

    if (status && status !== 'ALL') {
      if (status === 'OPEN_ONLY') {
        filters.push({ status: { in: ['OPEN', 'ACTIVE'] } })
      } else if (isInvestigationStatus(status)) {
        filters.push({ status })
      } else {
        return error('Unbekannter Status')
      }
    }

    if (priority && priority !== 'ALL') {
      if (!isInvestigationPriority(priority)) return error('Unbekannte Priorität')
      filters.push({ priority })
    }

    if (personId) {
      filters.push({ persons: { some: { personId } } })
    }

    if (search) {
      filters.push({
        OR: [
          { title: { contains: search } },
          { caseNumber: { contains: search } },
          { summary: { contains: search } },
          { leadAgent: { firstName: { contains: search } } },
          { leadAgent: { lastName: { contains: search } } },
          { leadAgent: { badgeNumber: { contains: search } } },
          { persons: { some: { person: { lastName: { contains: search } } } } },
          { persons: { some: { person: { alias: { contains: search } } } } },
        ],
      })
    }

    const investigations = await prisma.investigation.findMany({
      where: { AND: filters },
      include: investigationListInclude,
      orderBy: [{ updatedAt: 'desc' }],
    })

    return success(serializeBigInts(investigations))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('investigations:manage')
    const body = await req.json()

    const title = cleanText(body.title)
    if (!title) return error('Titel der Akte ist erforderlich')
    if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')

    const status = cleanText(body.status) || 'OPEN'
    if (!isInvestigationStatus(status)) return error('Unbekannter Status')

    const priority = cleanText(body.priority) || 'NORMAL'
    if (!isInvestigationPriority(priority)) return error('Unbekannte Priorität')

    const summary = cleanText(body.summary) || null
    const classified = body.classified === true
    const leadAgentId = cleanText(body.leadAgentId) || null

    let leadAgent = null
    if (leadAgentId) {
      leadAgent = await prisma.agent.findUnique({
        where: { id: leadAgentId },
        select: { id: true, firstName: true, lastName: true, badgeNumber: true },
      })
      if (!leadAgent) return error('Fallführender Agent wurde nicht gefunden', 404)
    }

    const assigneeIds = Array.isArray(body.assigneeIds)
      ? Array.from(
          new Set(
            (body.assigneeIds as unknown[])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
              .map((id) => id.trim()),
          ),
        )
      : []

    if (assigneeIds.length > 0) {
      const known = await prisma.user.count({ where: { id: { in: assigneeIds } } })
      if (known !== assigneeIds.length) return error('Mindestens ein Ermittler wurde nicht gefunden', 404)
    }

    const caseNumber = await nextInvestigationCaseNumber()

    const investigation = await prisma.investigation.create({
      data: {
        caseNumber,
        title,
        summary,
        status,
        priority,
        classified,
        leadAgentId,
        createdById: user.id,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
      include: investigationListInclude,
    })

    await createAuditLog({
      action: 'INVESTIGATION_CREATED',
      userId: user.id,
      details: `Ermittlungsakte ${caseNumber}: "${title}"${classified ? ' (Verschlusssache)' : ''}`,
    })

    queueDiscordInvestigationEvent({
      type: 'created',
      caseNumber,
      title,
      classified,
      leadAgentName: agentDisplayName(leadAgent),
      actorName: user.displayName,
      note: summary,
      rows: [
        { label: 'Status', value: INVESTIGATION_STATUS_LABELS[status] },
        { label: 'Priorität', value: INVESTIGATION_PRIORITY_LABELS[priority] },
      ],
    })

    return success(serializeBigInts(investigation), 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
