import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { qcShareSchema } from '@/lib/quality-checks'
import { createQcShare, managedQcSharesWhere, qcRouteError } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Eigene Freigabelinks (mit `settings:manage`: alle). Der geheime Link wird nie erneut ausgegeben. */
export async function GET() {
  try {
    const user = await requirePermission('quality-checks:manage')
    const shares = await prisma.qualityShare.findMany({
      where: managedQcSharesWhere(user),
      orderBy: { createdAt: 'desc' },
      omit: { tokenHash: true },
      include: { createdBy: { select: { displayName: true } } },
    })
    return success(shares)
  } catch (cause) {
    return qcRouteError(cause)
  }
}

/** Neuer Link – die Antwort enthält den Pfad genau einmal. */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { share, path } = await createQcShare(user, qcShareSchema.parse(await req.json()))
    return success({ share, path }, 201)
  } catch (cause) {
    return qcRouteError(cause)
  }
}
