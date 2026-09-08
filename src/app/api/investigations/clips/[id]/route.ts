import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { deleteClipFile } from '@/lib/clips'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  investigationAccessInclude,
  sanitizeTags,
  serializeBigInts,
} from '@/lib/investigations'
import { cleanText, parseDate, routeError } from '@/lib/investigations-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

const accessInclude = {
  investigation: { include: investigationAccessInclude },
} as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.bodycamClip.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Clip')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

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
        investigation: { select: { id: true, caseNumber: true, title: true, classified: true } },
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
      details: `Akte ${existing.investigation.caseNumber}: Clip "${clip.title}" bearbeitet`,
    })

    return success(serializeBigInts(clip))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const existing = await prisma.bodycamClip.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Clip')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

    const deleted = await prisma.bodycamClip.delete({ where: { id } })
    await Promise.all([deleted.filename, deleted.compressionSource, deleted.compressionOutput]
      .filter((filename): filename is string => Boolean(filename)).map(deleteClipFile))

    await createAuditLog({
      action: 'CLIP_DELETED',
      userId: user.id,
      details: `Akte ${existing.investigation.caseNumber}: Clip "${existing.title}" gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
