import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { qcShareUpdateSchema } from '@/lib/quality-checks'
import { qcRouteError, updateQcShare } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

/** Aktivieren/Deaktivieren, Ablauf, Laufbahn-Anzeige, Titel – oder mit `rotate` einen neuen Link erzeugen. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id } = await params
    const { share, path } = await updateQcShare(user, id, qcShareUpdateSchema.parse(await req.json()))
    return success({ share, path })
  } catch (cause) {
    return qcRouteError(cause)
  }
}
