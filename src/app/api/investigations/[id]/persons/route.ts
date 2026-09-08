import { NextRequest } from 'next/server'

import { error, forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import {
  INVESTIGATION_PERSON_ROLE_LABELS,
  canAccessInvestigation,
  investigationAccessInclude,
  isInvestigationPersonRole,
} from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

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

    const personId = cleanText(body.personId)
    if (!personId) return error('Person ist erforderlich')

    const role = cleanText(body.role) || 'SUSPECT'
    if (!isInvestigationPersonRole(role)) return error('Unbekannte Rolle')

    const person = await prisma.person.findUnique({ where: { id: personId } })
    if (!person) return notFound('Person')

    try {
      const link = await prisma.investigationPerson.create({
        data: {
          investigationId: id,
          personId,
          role,
          note: cleanText(body.note) || null,
        },
        include: { person: true },
      })

      await createAuditLog({
        action: 'INVESTIGATION_PERSON_LINKED',
        userId: user.id,
        details: `Akte ${investigation.caseNumber}: ${person.firstName} ${person.lastName} als ${INVESTIGATION_PERSON_ROLE_LABELS[role]} verknüpft`,
      })

      return success(link, 201)
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) {
        return error('Diese Person ist bereits in dieser Rolle verknüpft', 409)
      }
      throw cause
    }
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
