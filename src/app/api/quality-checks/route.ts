import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { qcCreateSchema } from '@/lib/quality-checks'
import { createQualityCheck, qcRouteError } from '@/lib/quality-checks-server'
import type { Prisma } from '@/generated/prisma'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

/** Liste der Kontrollen. Filter: `officer` (LSPD-ID), `status`, `q`, `page`. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission('quality-checks:view')
    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
    const q = (params.get('q') ?? '').trim().slice(0, 100)
    const status = params.get('status')
    const officer = params.get('officer')

    const where: Prisma.QualityCheckWhereInput = {
      ...(officer ? { lspdOfficerId: officer } : {}),
      ...(status === 'RUNNING' || status === 'COMPLETED' ? { status } : {}),
      ...(q
        ? { OR: [{ number: { contains: q } }, { officerName: { contains: q } }, { officerBadge: { contains: q } }, { location: { contains: q } }] }
        : {}),
    }
    const [items, total] = await Promise.all([
      prisma.qualityCheck.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        include: { entries: { select: { id: true, kind: true, correctsId: true } } },
      }),
      prisma.qualityCheck.count({ where }),
    ])
    return success({ items, total, page, pageSize: PAGE_SIZE })
  } catch (cause) {
    return qcRouteError(cause)
  }
}

/** Neue Kontrolle beginnen – der Beamte kommt aus dem LSPD-Panel. */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const input = qcCreateSchema.parse(await req.json())
    return success(await createQualityCheck(user, input), 201)
  } catch (cause) {
    return qcRouteError(cause)
  }
}
