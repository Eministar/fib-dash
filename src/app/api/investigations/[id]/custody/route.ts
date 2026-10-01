import { NextRequest } from 'next/server'

import { forbidden, notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation, investigationAccessInclude } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'
import { caseCustodyEvents } from '@/lib/custody-server'

export const dynamic = 'force-dynamic'

/** Beweisketten-Handlungen aller (auch gelöschten) Asservate einer Akte – für den Zeitstrahl. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
    const { id } = await params

    const investigation = await prisma.investigation.findUnique({
      where: { id },
      include: investigationAccessInclude,
    })
    if (!investigation) return notFound('Ermittlungsakte')
    if (!canAccessInvestigation(user, investigation)) return forbidden()

    return success(await caseCustodyEvents(id))
  } catch (cause: unknown) {
    return routeError(cause)
  }
}
