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
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseInteger(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isSafeInteger(num) ? num : null
}

async function generateCaseNumber(): Promise<string> {
  const currentYear = new Date().getFullYear()
  const prefix = `DAW-${currentYear}-`
  const count = await prisma.internalAffairsDaw.count({
    where: {
      caseNumber: {
        startsWith: prefix,
      },
    },
  })
  return `${prefix}${String(count + 1).padStart(3, '0')}`
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('internal-affairs:view')
    const { searchParams } = req.nextUrl
    const status = searchParams.get('status')?.trim()
    const agentId = searchParams.get('agentId')?.trim()
    const search = searchParams.get('search')?.trim().toLowerCase()

    const where: Prisma.InternalAffairsDawWhereInput = {}

    if (status && status !== 'ALL') {
      if (status === 'OPEN_ONLY') {
        where.status = { in: ['OPEN', 'IN_REVIEW'] }
      } else {
        where.status = status
      }
    }

    if (agentId) {
      where.agentId = agentId
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { caseNumber: { contains: search } },
        { allegation: { contains: search } },
        { statement: { contains: search } },
        { previousFirstName: { contains: search } },
        { previousLastName: { contains: search } },
        { previousBadgeNumber: { contains: search } },
        { agent: { firstName: { contains: search } } },
        { agent: { lastName: { contains: search } } },
        { agent: { badgeNumber: { contains: search } } },
      ]
    }

    const daws = await prisma.internalAffairsDaw.findMany({
      where,
      include: dawInclude,
      orderBy: [{ createdAt: 'desc' }],
    })

    return success(daws)
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

    const title = cleanText(body.title)
    if (!title) return error('Titel / Betreff der DAW ist erforderlich')
    if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')

    let caseNumber = cleanText(body.caseNumber)
    if (!caseNumber) {
      caseNumber = await generateCaseNumber()
    }

    const category = cleanText(body.category) || 'DAW'
    const agentId = cleanText(body.agentId) || null
    const allegation = cleanText(body.allegation) || null
    const statement = cleanText(body.statement) || null
    const penalGrade = cleanText(body.penalGrade) || null
    const sanctionSummary = cleanText(body.sanctionSummary) || null
    const fineAmount = parseInteger(body.fineAmount)
    const sgRounds = parseInteger(body.sgRounds)
    const suspensionHours = parseInteger(body.suspensionHours)
    const status = cleanText(body.status) || 'OPEN'
    const resolutionNote = cleanText(body.resolutionNote) || null
    const incidentAt = parseDate(body.incidentAt)
    const deadlineAt = parseDate(body.deadlineAt)

    let evidence: Prisma.InputJsonValue | undefined = undefined
    if (Array.isArray(body.evidence)) {
      const parsed = (body.evidence as RawEvidenceInput[])
        .filter((item) => item && typeof item.url === 'string' && item.url.trim())
        .map((item) => ({
          url: cleanText(item.url),
          title: cleanText(item.title) || null,
          description: cleanText(item.description) || null,
        }))
      evidence = parsed as unknown as Prisma.InputJsonValue
    }

    let previousFirstName = null
    let previousLastName = null
    let previousBadgeNumber = null
    let previousRank = null

    if (agentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          badgeNumber: true,
          rank: { select: { name: true } },
        },
      })
      if (!agent) return notFound('Agent')
      previousFirstName = agent.firstName
      previousLastName = agent.lastName
      previousBadgeNumber = agent.badgeNumber
      previousRank = agent.rank?.name || null
    }

    const daw = await prisma.internalAffairsDaw.create({
      data: {
        caseNumber,
        title,
        category,
        agentId,
        allegation,
        statement,
        penalGrade,
        sanctionSummary,
        fineAmount,
        sgRounds,
        suspensionHours,
        status,
        evidence,
        incidentAt,
        deadlineAt,
        resolutionNote,
        createdById: user.id,
        previousFirstName,
        previousLastName,
        previousBadgeNumber,
        previousRank,
      },
      include: dawInclude,
    })

    await createAuditLog({
      action: 'IA_DAW_CREATED',
      userId: user.id,
      agentId: agentId || undefined,
      details: `DAW ${caseNumber}: "${title}" für ${
        previousFirstName ? `${previousFirstName} ${previousLastName} (${previousBadgeNumber})` : 'Allgemein'
      }`,
    })

    return success(daw, 201)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
