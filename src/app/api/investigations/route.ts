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
  validateIdList,
} from '@/lib/investigations'
import {
  agentDisplayName,
  cleanText,
  nextInvestigationCaseNumber,
  routeError,
  validateAgentIds,
} from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'
import { tokenizedWhere } from '@/lib/search-match'
import { checklistFromTemplate, openRolesFromTemplate, toTemplateData } from '@/lib/investigation-templates'

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

    const searchWhere = tokenizedWhere(search, (token) => [
      { title: { contains: token } },
      { caseNumber: { contains: token } },
      { summary: { contains: token } },
      { leadAgent: { firstName: { contains: token } } },
      { leadAgent: { lastName: { contains: token } } },
      { leadAgent: { badgeNumber: { contains: token } } },
      { persons: { some: { person: { firstName: { contains: token } } } } },
      { persons: { some: { person: { lastName: { contains: token } } } } },
      { persons: { some: { person: { alias: { contains: token } } } } },
    ])
    if (searchWhere) filters.push(searchWhere)

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

    // Zugewiesene Ermittler duerfen die Akte auch dann sehen, wenn sie als
    // Verschlusssache angelegt wird.
    const assigneeIds = await validateAgentIds(body.assigneeIds)

    const mapSpotIds = validateIdList(body.mapSpotIds)
    if (mapSpotIds.length && (await prisma.mapSpot.count({ where: { id: { in: mapSpotIds } } })) !== mapSpotIds.length) {
      return error('Kartenpunkt wurde nicht gefunden', 404)
    }
    const photoIds = validateIdList(body.photoIds)
    if (photoIds.length && (await prisma.investigationPhoto.count({ where: { id: { in: photoIds } } })) !== photoIds.length) {
      return error('Bild wurde nicht gefunden', 404)
    }

    const dossierId = cleanText(body.dossierId) || null
    if (dossierId && !await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true } })) return error('Dauerakte wurde nicht gefunden', 404)

    // Vorlage: Checkliste und offene Rollen werden in die Akte kopiert, damit
    // spätere Änderungen an der Vorlage laufende Akten nicht verändern.
    const templateId = cleanText(body.templateId) || null
    let templateCopy: { checklist: ReturnType<typeof checklistFromTemplate>; openRoles: ReturnType<typeof openRolesFromTemplate> } | null = null
    if (templateId) {
      const template = await prisma.investigationTemplate.findUnique({ where: { id: templateId } })
      if (!template || !template.active) return error('Aktenvorlage wurde nicht gefunden oder ist deaktiviert', 404)
      const data = toTemplateData(template)
      templateCopy = { checklist: checklistFromTemplate(data.checklist), openRoles: openRolesFromTemplate(data.roles) }
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
        ...(templateCopy ? { templateId, checklist: templateCopy.checklist, openRoles: templateCopy.openRoles } : {}),
        ...(dossierId ? { dossiers: { connect: { id: dossierId } } } : {}),
        assignees: { create: assigneeIds.map((agentId) => ({ agentId, addedById: user.id })) },
        mapSpots: { connect: mapSpotIds.map((id) => ({ id })) },
        photos: { connect: photoIds.map((id) => ({ id })) },
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
        { label: 'Zugewiesen', value: assigneeIds.length ? `${assigneeIds.length} Ermittler` : null },
      ],
    })

    return success(serializeBigInts(investigation), 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
