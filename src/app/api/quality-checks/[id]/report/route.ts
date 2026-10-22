import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import {
  qcReportSchema,
} from '@/lib/quality-checks-schemas'
import { qcRouteError, updateQualityCheckReport } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Abschlussbericht einer abgeschlossenen Kontrolle überarbeiten. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id } = await params
    return success(await updateQualityCheckReport(user, id, qcReportSchema.parse(await req.json())))
  } catch (cause) {
    return qcRouteError(cause)
  }
}
