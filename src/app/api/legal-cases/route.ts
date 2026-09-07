import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  createLegalCase,
  legalCaseSelect,
  serializeLegalCase,
} from '@/lib/legal-case-service'
import { isLegalCaseKind } from '@/lib/legal-cases'

function cleanText(value: unknown, maxLength = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function cleanIdList(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean),
  )).slice(0, 40)
}

export async function GET() {
  try {
    await requirePermission('lad:view')
    const legalCases = await prisma.legalCase.findMany({
      select: legalCaseSelect,
      orderBy: { createdAt: 'desc' },
    })
    return success(legalCases)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('lad:manage')
    const body = await req.json()

    const kind = isLegalCaseKind(body.kind) ? body.kind : 'CUSTOM'
    const created = await createLegalCase({
      kind,
      agentId: typeof body.agentId === 'string' ? body.agentId : null,
      sanctionIds: cleanIdList(body.sanctionIds),
      title: cleanText(body.title, 200) ? cleanText(body.title, 200) : null,
      subject: cleanText(body.subject, 4000) || null,
      content: cleanText(body.content) || null,
      closing: cleanText(body.closing, 20000) || null,
      createdById: user.id,
    })

    await createAuditLog({
      action: 'LEGAL_CASE_CREATED',
      userId: user.id,
      agentId: created?.agentId ?? undefined,
      newValue: created?.caseNumber ?? '',
      details: `${created?.title ?? 'Klage'} (${created?.kind ?? '-'})`,
    })

    return success(created ? await serializeLegalCase(created) : null, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 400)
  }
}
