import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { linkedCorruptionFile, qcDetailInclude, qcRouteError } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Beamtenakte in fib-dash: alle Qualitätskontrollen plus verknüpfte Korruptionsakte. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ lspdId: string }> }) {
  try {
    await requirePermission('quality-checks:view')
    const { lspdId } = await params
    const [checks, corruption] = await Promise.all([
      prisma.qualityCheck.findMany({
        where: { lspdOfficerId: lspdId },
        orderBy: { startedAt: 'desc' },
        include: qcDetailInclude,
        take: 200,
      }),
      linkedCorruptionFile(lspdId),
    ])
    return success({ checks, corruption })
  } catch (cause) {
    return qcRouteError(cause)
  }
}
