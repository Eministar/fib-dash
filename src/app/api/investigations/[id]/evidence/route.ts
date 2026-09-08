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
import {
  cleanText,
  nextEvidenceNumber,
  parseDate,
  parseQuantity,
  routeError,
} from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: investigationAccessInclude,
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const title = cleanText(body.title)
    if (!title) return error('Bezeichnung des Asservats ist erforderlich')
    if (title.length > 200) return error('Bezeichnung ist zu lang (max. 200 Zeichen)')

    const kind = cleanText(body.kind) || 'OTHER'
    if (!isEvidenceKind(kind)) return error('Unbekannte Asservatenart')

    const status = cleanText(body.status) || 'SECURED'
    if (!isEvidenceStatus(status)) return error('Unbekannter Asservatenstatus')

    const entryId = cleanText(body.entryId) || null
    if (entryId) {
      const entry = await prisma.investigationEntry.findUnique({
        where: { id: entryId },
        select: { investigationId: true },
      })
      if (!entry) return notFound('Eintrag')
      if (entry.investigationId !== id) return error('Der Eintrag gehört nicht zu dieser Akte')
    }

    const seizedByAgentId = cleanText(body.seizedByAgentId) || null
    if (seizedByAgentId) {
      const agent = await prisma.agent.findUnique({
        where: { id: seizedByAgentId },
        select: { id: true },
      })
      if (!agent) return notFound('Agent')
    }

    const itemNumber = await nextEvidenceNumber()

    const evidence = await prisma.evidence.create({
      data: {
        investigationId: id,
        entryId,
        itemNumber,
        kind,
        status,
        title,
        description: cleanText(body.description) || null,
        quantity: parseQuantity(body.quantity),
        seizedAt: parseDate(body.seizedAt),
        seizedLocation: cleanText(body.seizedLocation).slice(0, 200) || null,
        seizedByAgentId,
        storageLocation: cleanText(body.storageLocation).slice(0, 200) || null,
        photoUrl: cleanText(body.photoUrl).slice(0, 2048) || null,
        createdById: user.id,
      },
      include: evidenceInclude,
    })

    await prisma.investigation.update({ where: { id }, data: { updatedAt: new Date() } })

    await createAuditLog({
      action: 'EVIDENCE_CREATED',
      userId: user.id,
      details: `Akte ${investigation.caseNumber}: Asservat ${itemNumber} "${title}" erfasst`,
    })

    return success(evidence, 201)
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
