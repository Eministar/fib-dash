import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * Verweist eine Akte auf eine andere. Die Gegenrichtung wird nicht zusaetzlich
 * gespeichert – beide Akten laden ihre `linksFrom` und `linksTo`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const toId = cleanText(body.toId)
    if (!toId) return error('Zielakte ist erforderlich')
    if (toId === id) return error('Eine Akte kann nicht auf sich selbst verweisen')

    const [from, to] = await Promise.all([
      prisma.investigation.findUnique({ where: { id }, include: investigationAccessInclude }),
      prisma.investigation.findUnique({ where: { id: toId }, include: investigationAccessInclude }),
    ])
    if (!from) return notFound('Ermittlungsakte')
    if (!to) return notFound('Zielakte')

    // Beide Seiten pruefen: sonst liesse sich ueber einen Querverweis der Kopf
    // einer Verschlusssache in eine offene Akte spiegeln.
    if (!canAccessInvestigation(user, from) || !canAccessInvestigation(user, to)) return forbidden()

    try {
      const link = await prisma.investigationLink.create({
        data: { fromId: id, toId, note: cleanText(body.note) || null, createdById: user.id },
        include: {
          to: {
            select: {
              id: true,
              caseNumber: true,
              title: true,
              status: true,
              priority: true,
              classified: true,
            },
          },
        },
      })

      await createAuditLog({
        action: 'INVESTIGATION_LINKED',
        userId: user.id,
        details: `Akte ${from.caseNumber} verweist auf ${to.caseNumber}`,
      })

      return success(link, 201)
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) {
        return error('Dieser Querverweis besteht bereits', 409)
      }
      throw cause
    }
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
