import { NextRequest } from 'next/server'

import { error, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { PERSON_LINK_TYPE_LABELS, isPersonLinkType } from '@/lib/investigations'
import { cleanText, routeError } from '@/lib/investigations-server'
import { isUniqueConstraintError } from '@/lib/prisma-errors'

export const dynamic = 'force-dynamic'

/**
 * Verbindet zwei Personen gerichtet ("A ist Arbeitgeber von B"). Die
 * Gegenrichtung wird beim Lesen der Personenakte mitgeladen, nicht zusaetzlich
 * gespeichert – sonst muessten beide Zeilen konsistent gehalten werden.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:manage')
    const { id } = await params
    const body = await req.json()

    const toPersonId = cleanText(body.toPersonId)
    if (!toPersonId) return error('Zielperson ist erforderlich')
    if (toPersonId === id) return error('Eine Person kann nicht mit sich selbst verbunden werden')

    const type = cleanText(body.type) || 'ASSOCIATE'
    if (!isPersonLinkType(type)) return error('Unbekannte Verbindungsart')

    const [from, to] = await Promise.all([
      prisma.person.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } }),
      prisma.person.findUnique({
        where: { id: toPersonId },
        select: { id: true, firstName: true, lastName: true },
      }),
    ])
    if (!from) return notFound('Person')
    if (!to) return notFound('Zielperson')

    try {
      const link = await prisma.personLink.create({
        data: {
          fromPersonId: id,
          toPersonId,
          type,
          note: cleanText(body.note) || null,
          createdById: user.id,
        },
        include: { toPerson: true },
      })

      await createAuditLog({
        action: 'PERSON_LINKED',
        userId: user.id,
        details: `${from.firstName} ${from.lastName} → ${PERSON_LINK_TYPE_LABELS[type]} → ${to.firstName} ${to.lastName}`,
      })

      return success(link, 201)
    } catch (cause: unknown) {
      if (isUniqueConstraintError(cause)) {
        return error('Diese Verbindung besteht bereits', 409)
      }
      throw cause
    }
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
