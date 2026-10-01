import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { qcGradeSchema } from '@/lib/quality-checks'
import { gradeQualityCheck, qcRouteError } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Schulnote (1+ bis 6) einer laufenden Kontrolle setzen oder entfernen. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id } = await params
    return success(await gradeQualityCheck(user, id, qcGradeSchema.parse(await req.json())))
  } catch (cause) {
    return qcRouteError(cause)
  }
}
