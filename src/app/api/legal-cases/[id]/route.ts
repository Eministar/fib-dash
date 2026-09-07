import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  loadLegalCaseById,
  serializeLegalCase,
} from '@/lib/legal-case-service'
import { LEGAL_CASE_STATUSES, type LegalCaseStatusValue } from '@/lib/legal-cases'

type RouteContext = { params: Promise<{ id: string }> }

function cleanText(value: unknown, maxLength = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function isLegalCaseStatus(value: unknown): value is LegalCaseStatusValue {
  return typeof value === 'string' && (LEGAL_CASE_STATUSES as readonly string[]).includes(value)
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requirePermission('lad:view')
    const { id } = await params
    const legalCase = await loadLegalCaseById(id)
    if (!legalCase) return notFound('Klage')
    return success(await serializeLegalCase(legalCase))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requirePermission('lad:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await loadLegalCaseById(id)
    if (!existing) return notFound('Klage')

    const data: Record<string, unknown> = {}
    const changes: string[] = []

    if (isLegalCaseStatus(body.status) && body.status !== existing.status) {
      const now = new Date()
      data.status = body.status
      if (body.status === 'FILED' && !existing.filedAt) {
        data.filedAt = now
        changes.push('Klage eingereicht')
      }
      if (body.status === 'CLOSED') {
        data.closedAt = now
        changes.push('Klage geschlossen')
      }
      if (body.status === 'DRAFT') {
        data.filedAt = null
        data.closedAt = null
        changes.push('Klage zurück auf Entwurf')
      }
    }

    if ('title' in body) {
      const title = cleanText(body.title, 200)
      if (!title) return error('Titel darf nicht leer sein')
      if (title !== existing.title) {
        data.title = title
        changes.push('Titel geändert')
      }
    }
    if ('subject' in body) {
      data.subject = cleanText(body.subject, 4000)
      changes.push('Betreff geändert')
    }
    if ('content' in body) {
      const content = cleanText(body.content)
      if (!content) return error('Der Sachverhalt darf nicht leer sein')
      if (content !== existing.content) {
        data.content = content
        changes.push('Sachverhalt geändert')
      }
    }
    if ('closing' in body) {
      data.closing = cleanText(body.closing, 20000) || null
      changes.push('Antrag geändert')
    }

    const updated = await prisma.legalCase.update({ where: { id }, data, select: { id: true, caseNumber: true, title: true, status: true, agentId: true } })

    if (changes.length > 0) {
      await createAuditLog({
        action: 'LEGAL_CASE_UPDATED',
        userId: user.id,
        agentId: updated.agentId ?? undefined,
        oldValue: existing.status,
        newValue: updated.status,
        details: `${updated.caseNumber} · ${changes.join('; ')}`,
      })
    }

    const reloaded = await loadLegalCaseById(id)
    return success(reloaded ? await serializeLegalCase(reloaded) : null)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const user = await requirePermission('lad:manage')
    const { id } = await params
    const existing = await loadLegalCaseById(id)
    if (!existing) return notFound('Klage')

    await prisma.$transaction(async (tx) => {
      await tx.sanction.updateMany({
        where: { legalCaseId: id },
        data: { status: 'OPEN', legalCaseId: null },
      })
      await tx.legalCase.delete({ where: { id } })
    })

    await createAuditLog({
      action: 'LEGAL_CASE_DELETED',
      userId: user.id,
      agentId: existing.agentId ?? undefined,
      oldValue: existing.caseNumber,
      details: existing.title,
    })

    return success({ id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
