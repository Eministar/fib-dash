import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requireAuth, type CurrentUser } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit/audit'
import { deleteClipFile } from '@/lib/media/clips'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  investigationAccessInclude,
  sanitizeTags,
  serializeBigInts,
} from '@/lib/investigations/investigations'
import { cleanText, parseDate, routeError } from '@/lib/investigations/investigations-server'
import { canManageAgentRecordClip, isAgentRecordClip } from '@/lib/investigations/bodycam-access'
import { hasPermission } from '@/lib/permissions'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

const accessInclude = {
  investigation: { include: investigationAccessInclude },
  agentRecordEntry: { select: { agentId: true, title: true } },
} as const

type ExistingClip = Prisma.BodycamClipGetPayload<{ include: typeof accessInclude }>

/**
 * Akten-Clips: Aktenpflege plus Einsicht in genau diese Akte. Clips aus einer
 * Agent-Akte: dieselben Rechte wie Einträge der Agent-Akte.
 */
function canManageClip(user: CurrentUser, clip: ExistingClip) {
  if (isAgentRecordClip(clip)) return canManageAgentRecordClip(user)
  return hasPermission(user, 'investigations:manage') && !!clip.investigation && canAccessInvestigation(user, clip.investigation)
}

/** Wo der Clip hängt – für das Protokoll. */
function clipPlace(clip: ExistingClip) {
  return clip.investigation ? `Akte ${clip.investigation.caseNumber}` : `Agent-Akte „${clip.agentRecordEntry?.title ?? '–'}“`
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.bodycamClip.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Clip')
    if (!canManageClip(user, existing)) return forbidden()

    const data: Prisma.BodycamClipUpdateInput = {}

    if (body.title !== undefined) {
      const title = cleanText(body.title)
      if (!title) return error('Titel des Clips ist erforderlich')
      if (title.length > 200) return error('Titel ist zu lang (max. 200 Zeichen)')
      data.title = title
    }

    if (body.description !== undefined) data.description = cleanText(body.description) || null
    if (body.location !== undefined) data.location = cleanText(body.location).slice(0, 200) || null
    if (body.recordedAt !== undefined) data.recordedAt = parseDate(body.recordedAt)
    if (body.tags !== undefined) data.tags = sanitizeTags(body.tags)

    if (body.entryId !== undefined) {
      const entryId = cleanText(body.entryId) || null
      if (entryId) {
        const entry = await prisma.investigationEntry.findUnique({
          where: { id: entryId },
          select: { investigationId: true },
        })
        if (!entry) return notFound('Eintrag')
        if (entry.investigationId !== existing.investigationId) {
          return error('Der Eintrag gehört nicht zu dieser Akte')
        }
        data.entry = { connect: { id: entryId } }
      } else {
        data.entry = { disconnect: true }
      }
    }

    if (body.recordedByAgentId !== undefined) {
      const agentId = cleanText(body.recordedByAgentId) || null
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
        if (!agent) return notFound('Agent')
        data.recordedByAgent = { connect: { id: agentId } }
      } else {
        data.recordedByAgent = { disconnect: true }
      }
    }

    const clip = await prisma.bodycamClip.update({
      where: { id },
      data,
      include: {
        investigation: { select: { id: true, caseNumber: true, title: true } },
        entry: { select: { id: true, title: true, kind: true } },
        recordedByAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            badgeNumber: true,
            rank: { select: { id: true, name: true, color: true } },
          },
        },
        uploadedBy: { select: { id: true, displayName: true } },
      },
    })

    await createAuditLog({
      action: 'CLIP_UPDATED',
      userId: user.id,
      agentId: existing.agentRecordEntry?.agentId,
      details: `${clipPlace(existing)}: Clip "${clip.title}" bearbeitet`,
    })

    return success(serializeBigInts(clip))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    const { id } = await params

    const existing = await prisma.bodycamClip.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Clip')
    if (!canManageClip(user, existing)) return forbidden()

    const deleted = await prisma.bodycamClip.delete({ where: { id } })
    await Promise.all([deleted.filename, deleted.compressionSource, deleted.compressionOutput]
      .filter((filename): filename is string => Boolean(filename)).map(deleteClipFile))

    await createAuditLog({
      action: 'CLIP_DELETED',
      userId: user.id,
      agentId: existing.agentRecordEntry?.agentId,
      details: `${clipPlace(existing)}: Clip "${existing.title}" gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
