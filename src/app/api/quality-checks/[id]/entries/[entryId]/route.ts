import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { qcEntryUpdateSchema } from '@/lib/quality-checks'
import { deleteQualityEntry, qcRouteError, updateQualityEntry } from '@/lib/quality-checks-server'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; entryId: string }> }

/** Eintrag einer laufenden Kontrolle bearbeiten (Art, Text, Zeitpunkt). */
export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id, entryId } = await params
    return success(await updateQualityEntry(user, id, entryId, qcEntryUpdateSchema.parse(await req.json())))
  } catch (cause) {
    return qcRouteError(cause)
  }
}

/** Eintrag einer laufenden Kontrolle löschen. */
export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const user = await requirePermission('quality-checks:manage')
    const { id, entryId } = await params
    return success(await deleteQualityEntry(user, id, entryId))
  } catch (cause) {
    return qcRouteError(cause)
  }
}
