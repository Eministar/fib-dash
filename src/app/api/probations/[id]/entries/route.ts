import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { PROBATION_ENTRY_RATING_LABELS, probationEntryRating } from '@/lib/probations'

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('probations:manage')
    const { id } = await params
    const body = await req.json()
    const rating = probationEntryRating(cleanText(body.rating).toUpperCase())
    const comment = cleanText(body.comment)

    if (!rating) return error('Bewertung ist ungültig')
    if (!comment) return error('Kommentar ist erforderlich')

    const probation = await prisma.probation.findUnique({
      where: { id },
      include: { agent: true },
    })
    if (!probation) return notFound('Probezeit')

    const entry = await prisma.probationEntry.create({
      data: {
        probationId: id,
        rating,
        comment,
        createdById: user.id,
      },
      include: { createdBy: { select: { displayName: true } } },
    })

    await createAuditLog({
      action: 'PROBATION_ENTRY_CREATED',
      userId: user.id,
      agentId: probation.agentId,
      details: `${probation.agent.firstName} ${probation.agent.lastName}: ${PROBATION_ENTRY_RATING_LABELS[rating]}`,
    })

    return success(entry, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
