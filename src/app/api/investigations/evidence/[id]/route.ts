import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import {
  canAccessInvestigation,
  evidenceInclude,
  investigationAccessInclude,
  isEvidenceKind,
  isEvidenceStatus,
} from '@/lib/investigations'
import { cleanText, parseDate, parseQuantity, routeError } from '@/lib/investigations-server'
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

    const existing = await prisma.evidence.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Asservat')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

    const data: Prisma.EvidenceUpdateInput = {}

    if (body.title !== undefined) {
      const title = cleanText(body.title)
      if (!title) return error('Bezeichnung des Asservats ist erforderlich')
      data.title = title.slice(0, 200)
    }

    if (body.kind !== undefined) {
      const kind = cleanText(body.kind)
      if (!isEvidenceKind(kind)) return error('Unbekannte Asservatenart')
      data.kind = kind
    }

    if (body.status !== undefined) {
      const status = cleanText(body.status)
      if (!isEvidenceStatus(status)) return error('Unbekannter Asservatenstatus')
      data.status = status
    }

    if (body.description !== undefined) data.description = cleanText(body.description) || null
    if (body.quantity !== undefined) data.quantity = parseQuantity(body.quantity)
    if (body.seizedAt !== undefined) data.seizedAt = parseDate(body.seizedAt)
    if (body.seizedLocation !== undefined) {
      data.seizedLocation = cleanText(body.seizedLocation).slice(0, 200) || null
    }
    if (body.storageLocation !== undefined) {
      data.storageLocation = cleanText(body.storageLocation).slice(0, 200) || null
    }
    if (body.photoUrl !== undefined) data.photoUrl = cleanText(body.photoUrl).slice(0, 2048) || null

    if (body.seizedByAgentId !== undefined) {
      const agentId = cleanText(body.seizedByAgentId) || null
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } })
        if (!agent) return notFound('Agent')
        data.seizedByAgent = { connect: { id: agentId } }
      } else {
        data.seizedByAgent = { disconnect: true }
      }
    }

    const evidence = await prisma.evidence.update({
      where: { id },
      data,
      include: evidenceInclude,
    })

    await createAuditLog({
      action: 'EVIDENCE_UPDATED',
      userId: user.id,
      details: `Akte ${existing.investigation.caseNumber}: Asservat ${evidence.itemNumber} bearbeitet`,
    })

    return success(evidence)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const existing = await prisma.evidence.findUnique({ where: { id }, include: accessInclude })
    if (!existing) return notFound('Asservat')
    if (!canAccessInvestigation(user, existing.investigation)) return forbidden()

    await prisma.evidence.delete({ where: { id } })

    await createAuditLog({
      action: 'EVIDENCE_DELETED',
      userId: user.id,
      details: `Akte ${existing.investigation.caseNumber}: Asservat ${existing.itemNumber} "${existing.title}" gelöscht`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
