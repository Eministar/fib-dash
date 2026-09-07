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

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: {
        leadAgent: { select: { discordId: true } },
        assignees: { select: { userId: true } },
      },
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const title = cleanText(body.title)
    if (!title) return error('Titel des Eintrags ist erforderlich')
    if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')

    const kind = cleanText(body.kind) || 'OPERATION'
    if (!isInvestigationEntryKind(kind)) return error('Unbekannte Eintragsart')

    const occurredAt = parseDate(body.occurredAt) ?? new Date()
    const location = cleanText(body.location).slice(0, 200) || null
    const content = cleanText(body.content) || null
    const participants = sanitizeParticipants(body.participants)

    const entry = await prisma.investigationEntry.create({
      data: {
        investigationId: id,
        kind,
        title,
        content,
        occurredAt,
        location,
        participants: asJson(participants),
        createdById: user.id,
      },
      include: {
        createdBy: { select: { id: true, displayName: true } },
        clips: true,
      },
    })

    // Die Akte gilt als angefasst, damit sie in der nach `updatedAt`
    // sortierten Liste nach oben rutscht.
    await prisma.investigation.update({ where: { id }, data: { updatedAt: new Date() } })

    await createAuditLog({
      action: 'INVESTIGATION_ENTRY_CREATED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: Eintrag "${title}" hinzugefügt`,
    })

    return success(serializeBigInts(entry), 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
