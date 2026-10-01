import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { qcEntrySchema } from '@/lib/quality-checks'
import { addQualityEntry, qcRouteError } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Protokolleintrag hinzufügen (positiv, negativ, Notiz – optional als Korrektur). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id } = await params
    return success(await addQualityEntry(user, id, qcEntrySchema.parse(await req.json())), 201)
  } catch (cause) {
    return qcRouteError(cause)
  }
}
