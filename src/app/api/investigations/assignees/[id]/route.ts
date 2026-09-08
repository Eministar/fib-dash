import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { agentDisplayName, routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const assignee = await prisma.investigationAssignee.findUnique({
      where: { id },
      include: {
        agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
        investigation: { include: investigationAccessInclude },
      },
    })
    if (!assignee) return notFound('Zuweisung')
    if (!canAccessInvestigation(user, assignee.investigation)) return forbidden()

    await prisma.investigationAssignee.delete({ where: { id } })

    await createAuditLog({
      action: 'INVESTIGATION_ASSIGNEE_REMOVED',
      userId: user.id,
      agentId: assignee.agentId,
      details: `Akte ${assignee.investigation.caseNumber}: ${agentDisplayName(assignee.agent)} als Ermittler entfernt`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
