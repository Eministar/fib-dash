import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const link = await prisma.investigationPerson.findUnique({
      where: { id },
      include: {
        person: { select: { firstName: true, lastName: true } },
        investigation: {
          include: {
            leadAgent: { select: { discordId: true } },
            assignees: { select: { userId: true } },
          },
        },
      },
    })
    if (!link) return notFound('Verknüpfung')
    if (!canAccessInvestigation(user, link.investigation)) return forbidden()

    await prisma.investigationPerson.delete({ where: { id } })

    await createAuditLog({
      action: 'INVESTIGATION_PERSON_UNLINKED',
      userId: user.id,
      details: `Akte ${link.investigation.caseNumber}: ${link.person.firstName} ${link.person.lastName} entfernt`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
