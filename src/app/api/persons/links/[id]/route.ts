import { NextRequest } from 'next/server'

import { notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params

    const link = await prisma.personLink.findUnique({
      where: { id },
      include: {
        fromPerson: { select: { firstName: true, lastName: true } },
        toPerson: { select: { firstName: true, lastName: true } },
      },
    })
    if (!link) return notFound('Verbindung')

    await prisma.personLink.delete({ where: { id } })

    await createAuditLog({
      action: 'PERSON_UNLINKED',
      userId: user.id,
      details: `Verbindung ${link.fromPerson.firstName} ${link.fromPerson.lastName} → ${link.toPerson.firstName} ${link.toPerson.lastName} entfernt`,
    })

    return success({ id })
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
