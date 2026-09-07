import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  isInvestigationEntryKind,
  sanitizeParticipants,
  serializeBigInts,
} from '@/lib/investigations'
import { asJson, cleanText, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

const accessInclude = {
  investigation: {
    include: {
      leadAgent: { select: { discordId: true } },
      assignees: { select: { userId: true } },
    },
  },
} as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.investigationEntry.findUnique({
      where: { id },
      include: accessInclude,
    })
    if (!existing) return notFound('Eintrag')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

    const data: Prisma.InvestigationEntryUpdateInput = {}

    if (body.title !== undefined) {
      const title = cleanText(body.title)
      if (!title) return error('Titel des Eintrags ist erforderlich')
      if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')
      data.title = title
    }

    if (body.kind !== undefined) {
      const kind = cleanText(body.kind)
      if (!isInvestigationEntryKind(kind)) return error('Unbekannte Eintragsart')
      data.kind = kind
    }

    if (body.content !== undefined) data.content = cleanText(body.content) || null
    if (body.location !== undefined) data.location = cleanText(body.location).slice(0, 200) || null
    if (body.participants !== undefined) data.participants = asJson(sanitizeParticipants(body.participants))

    if (body.occurredAt !== undefined) {
      const occurredAt = parseDate(body.occurredAt)
      if (!occurredAt) return error('Zeitpunkt ist ungültig')
      data.occurredAt = occurredAt
    }

    const entry = await prisma.investigationEntry.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, displayName: true } },
        clips: true,
      },
    })

    await createAuditLog({
      action: 'INVESTIGATION_ENTRY_UPDATED',
      userId: user.id,
      details: `Akte ${existing.investigation.caseNumber}: Eintrag "${entry.title}" bearbeitet`,
    })

    return success(serializeBigInts(entry))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const existing = await prisma.investigationEntry.findUnique({
      where: { id },
      include: accessInclude,
    })
    if (!existing) return notFound('Eintrag')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

    // Clips überleben das Löschen des Eintrags und bleiben an der Akte hängen
    // (`entryId` ist onDelete: SetNull) – Beweismittel gehen so nicht verloren.
    await prisma.investigationEntry.delete({ where: { id } })

    await createAuditLog({
      action: 'INVESTIGATION_ENTRY_DELETED',
      userId: user.id,
      details: `Akte ${existing.investigation.caseNumber}: Eintrag "${existing.title}" gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
