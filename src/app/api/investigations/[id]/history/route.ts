import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/**
 * Änderungsverlauf einer Akte aus dem Prüfprotokoll.
 *
 * Die Zuordnung läuft über die Aktennummer im Freitextfeld `details` – das
 * Protokoll führt keinen Fremdschlüssel auf die Akte. Aktennummern wie
 * „ERM-0042“ sind eindeutig genug dafür; ein Querverweis, der zwei Nummern
 * nennt, erscheint bewusst in beiden Akten.
 */
export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: investigationAccessInclude,
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    const entries = await prisma.auditLog.findMany({
      where: { details: { contains: investigation.caseNumber } },
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        user: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return success(
      entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
        userName: entry.user?.displayName ?? 'System',
      })),
    )
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
