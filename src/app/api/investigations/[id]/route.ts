import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { deleteClipFile } from '@/lib/clips'
import { queueDiscordInvestigationEvent } from '@/lib/discord-integration'
import { prisma } from '@/lib/prisma'
import {
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
  canAccessInvestigation,
  investigationAccessInclude,
  investigationDetailInclude,
  isInvestigationPriority,
  isInvestigationStatus,
  serializeBigInts,
} from '@/lib/investigations'
import {
  agentDisplayName,
  cleanText,
  routeError,
  validateAgentIds,
} from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: investigationDetailInclude,
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    return success(serializeBigInts(investigation))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.investigation.findUnique({
      where: { id },
      include: investigationAccessInclude,
    })
    if (!existing) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, existing)) return forbidden()

    const data: Prisma.InvestigationUpdateInput = {}

    if (body.title !== undefined) {
      const title = cleanText(body.title)
      if (!title) return error('Titel der Akte ist erforderlich')
      if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')
      data.title = title
    }

    if (body.summary !== undefined) {
      data.summary = cleanText(body.summary) || null
    }

    if (body.status !== undefined) {
      const status = cleanText(body.status)
      if (!isInvestigationStatus(status)) return error('Unbekannter Status')
      data.status = status
      // Abschlusszeitpunkt folgt dem Status, damit die Akte nicht doppelt
      // gepflegt werden muss.
      data.closedAt = status === 'CLOSED' || status === 'ARCHIVED' ? existing.closedAt ?? new Date() : null
    }

    if (body.priority !== undefined) {
      const priority = cleanText(body.priority)
      if (!isInvestigationPriority(priority)) return error('Unbekannte Priorität')
      data.priority = priority
    }

    if (body.classified !== undefined) {
      data.classified = body.classified === true
    }

    if (body.leadAgentId !== undefined) {
      const leadAgentId = cleanText(body.leadAgentId) || null
      if (leadAgentId) {
        const agent = await prisma.agent.findUnique({ where: { id: leadAgentId }, select: { id: true } })
        if (!agent) return notFound('Agent')
        data.leadAgent = { connect: { id: leadAgentId } }
      } else {
        data.leadAgent = { disconnect: true }
      }
    }

    if (body.assigneeIds !== undefined) {
      // Ersetzt die komplette Liste. Einzelne Ermittler laufen ueber
      // /api/investigations/[id]/assignees, damit gleichzeitige Zuweisungen
      // sich nicht gegenseitig ueberschreiben.
      const assigneeIds = await validateAgentIds(body.assigneeIds)
      data.assignees = {
        deleteMany: {},
        create: assigneeIds.map((agentId) => ({ agentId, addedById: user.id })),
      }
    }

    const investigation = await prisma.investigation.update({
      where: { id },
      data,
      include: investigationDetailInclude,
    })

    await createAuditLog({
      action: 'INVESTIGATION_UPDATED',
      userId: user.id,
      details: `Ermittlungsakte ${investigation.caseNumber}: "${investigation.title}" bearbeitet`,
    })

    if (body.status !== undefined && body.status !== existing.status) {
      const closing = investigation.status === 'CLOSED' || investigation.status === 'ARCHIVED'
      queueDiscordInvestigationEvent({
        type: closing ? 'closed' : 'status',
        caseNumber: investigation.caseNumber,
        title: investigation.title,
        classified: investigation.classified,
        leadAgentName: agentDisplayName(investigation.leadAgent),
        actorName: user.displayName,
        rows: [
          { label: 'Vorher', value: INVESTIGATION_STATUS_LABELS[existing.status] },
          { label: 'Jetzt', value: INVESTIGATION_STATUS_LABELS[investigation.status] },
          { label: 'Priorität', value: INVESTIGATION_PRIORITY_LABELS[investigation.priority] },
        ],
      })
    }

    return success(serializeBigInts(investigation))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:delete')
    const { id } = await params

    const existing = await prisma.investigation.findUnique({
      where: { id },
      include: { ...investigationAccessInclude, clips: { select: { filename: true } } },
    })
    if (!existing) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, existing)) return forbidden()

    // Erst der Datensatz, dann die Dateien: bleibt ein Löschvorgang auf der
    // Platte hängen, ist die Akte trotzdem fort und es entstehen höchstens
    // verwaiste Dateien statt toter Datenbankverweise.
    const deletedClips = await prisma.$transaction(async tx => {
      const clips = await tx.bodycamClip.findMany({ where: { investigationId: id }, select: { id: true } })
      const deleted = []
      for (const clip of clips) deleted.push(await tx.bodycamClip.delete({ where: { id: clip.id } }))
      await tx.investigation.delete({ where: { id } })
      return deleted
    }, { isolationLevel: 'Serializable' })
    for (const clip of deletedClips) {
      for (const filename of new Set([clip.filename, clip.compressionSource, clip.compressionOutput])) {
        if (filename) await deleteClipFile(filename)
      }
    }

    await createAuditLog({
      action: 'INVESTIGATION_DELETED',
      userId: user.id,
      details: `Ermittlungsakte ${existing.caseNumber}: "${existing.title}" gelöscht (${existing.clips.length} Clips)`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
