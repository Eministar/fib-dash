import { NextRequest } from 'next/server'

import { notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { qcCompleteSchema } from '@/lib/quality-checks'
import { completeQualityCheck, qcDetailInclude, qcRouteError } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    await requirePermission('quality-checks:view')
    const { id } = await params
    const check = await prisma.qualityCheck.findUnique({ where: { id }, include: qcDetailInclude })
    return check ? success(check) : notFound('Qualitätskontrolle')
  } catch (cause) {
    return qcRouteError(cause)
  }
}

/** Abschließen: Gesamtbewertung, Fazit, Ende. Danach ist das Protokoll geschlossen. */
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id } = await params
    return success(await completeQualityCheck(user, id, qcCompleteSchema.parse(await req.json())))
  } catch (cause) {
    return qcRouteError(cause)
  }
}
