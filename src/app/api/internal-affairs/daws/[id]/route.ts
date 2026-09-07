import { NextRequest } from 'next/server'

import { createAuditLog } from '@/lib/audit'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

interface RawEvidenceInput {
  url?: unknown
  title?: unknown
  description?: unknown
}

const dawInclude = {
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      status: true,
      rank: { select: { id: true, name: true, color: true } },
    },
  },
  createdBy: {
    select: {
      id: true,
      displayName: true,
    },
  },
} as const

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDate(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseInteger(value: unknown) {
  if (value === null) return null
  if (value === undefined || value === '') return undefined
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isSafeInteger(num) ? num : undefined
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePermission('internal-affairs:view')
    const { id } = await params

    const daw = await prisma.internalAffairsDaw.findUnique({
      where: { id },
      include: dawInclude,
    })

    if (!daw) return notFound('DAW')
    return success(daw)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission('internal-affairs:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.internalAffairsDaw.findUnique({
      where: { id },
    })
    if (!existing) return notFound('DAW')

    const updateData: Prisma.InternalAffairsDawUpdateInput = {}

    if (body.title !== undefined) {
      const title = cleanText(body.title)
      if (!title) return error('Titel / Betreff ist erforderlich')
      if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')
      updateData.title = title
    }

    if (body.caseNumber !== undefined) {
      const caseNumber = cleanText(body.caseNumber)
      if (caseNumber) updateData.caseNumber = caseNumber
    }

    if (body.category !== undefined) {
      updateData.category = cleanText(body.category) || 'DAW'
    }

    if (body.agentId !== undefined) {
      const agentId = cleanText(body.agentId) || null
      if (agentId) {
        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
          select: { firstName: true, lastName: true, badgeNumber: true, rank: { select: { name: true } } },
        })
        if (agent) {
          updateData.agent = { connect: { id: agentId } }
          updateData.previousFirstName = agent.firstName
          updateData.previousLastName = agent.lastName
          updateData.previousBadgeNumber = agent.badgeNumber
          updateData.previousRank = agent.rank?.name || null
        }
      } else {
        updateData.agent = { disconnect: true }
      }
    }

    if (body.allegation !== undefined) updateData.allegation = cleanText(body.allegation) || null
    if (body.statement !== undefined) updateData.statement = cleanText(body.statement) || null
    if (body.penalGrade !== undefined) updateData.penalGrade = cleanText(body.penalGrade) || null
    if (body.sanctionSummary !== undefined) updateData.sanctionSummary = cleanText(body.sanctionSummary) || null

    if (body.fineAmount !== undefined) updateData.fineAmount = parseInteger(body.fineAmount)
    if (body.sgRounds !== undefined) updateData.sgRounds = parseInteger(body.sgRounds)
    if (body.suspensionHours !== undefined) updateData.suspensionHours = parseInteger(body.suspensionHours)
    if (body.status !== undefined) updateData.status = cleanText(body.status) || 'OPEN'
    if (body.resolutionNote !== undefined) updateData.resolutionNote = cleanText(body.resolutionNote) || null

    if (body.incidentAt !== undefined) updateData.incidentAt = parseDate(body.incidentAt)
    if (body.deadlineAt !== undefined) updateData.deadlineAt = parseDate(body.deadlineAt)

    if (body.evidence !== undefined) {
      if (Array.isArray(body.evidence)) {
        const parsed = (body.evidence as RawEvidenceInput[])
          .filter((item) => item && typeof item.url === 'string' && item.url.trim())
          .map((item) => ({
            url: cleanText(item.url),
            title: cleanText(item.title) || null,
            description: cleanText(item.description) || null,
          }))
        updateData.evidence = parsed as unknown as Prisma.InputJsonValue
      } else {
        updateData.evidence = Prisma.DbNull
      }
    }

    const updated = await prisma.internalAffairsDaw.update({
      where: { id },
      data: updateData,
      include: dawInclude,
    })

    await createAuditLog({
      action: 'IA_DAW_UPDATED',
      userId: user.id,
      agentId: updated.agentId || undefined,
      details: `DAW ${updated.caseNumber}: Aktualisiert (${updated.status})`,
    })

    return success(updated)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePermission('internal-affairs:manage')
    const { id } = await params

    const existing = await prisma.internalAffairsDaw.findUnique({
      where: { id },
      select: { id: true, caseNumber: true, title: true, agentId: true },
    })
    if (!existing) return notFound('DAW')

    await prisma.internalAffairsDaw.delete({
      where: { id },
    })

    await createAuditLog({
      action: 'IA_DAW_DELETED',
      userId: user.id,
      agentId: existing.agentId || undefined,
      details: `DAW ${existing.caseNumber} gelöscht: "${existing.title}"`,
    })

    return success({ success: true })
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
