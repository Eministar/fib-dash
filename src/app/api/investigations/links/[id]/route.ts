import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const link = await prisma.investigationLink.findUnique({
      where: { id },
      include: {
        from: { include: investigationAccessInclude },
        to: { select: { caseNumber: true } },
      },
    })
    if (!link) return notFound('Querverweis')
    if (!canAccessInvestigation(user, link.from)) return forbidden()

    await prisma.investigationLink.delete({ where: { id } })

    await createAuditLog({
      action: 'INVESTIGATION_UNLINKED',
      userId: user.id,
      details: `Querverweis ${link.from.caseNumber} → ${link.to.caseNumber} entfernt`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
