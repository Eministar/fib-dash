import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import { authorizeUploadKind } from '@/lib/upload-authorization'
import {
  assembleUploadSession,
  loadOwnedSessionUnchecked,
  UploadSessionError,
  type UploadKind,
} from '@/lib/upload-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** Setzt die Chunks zusammen und prüft Größe, Signatur und Gesamtprüfsumme. */
export async function POST(_req: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const session = await loadOwnedSessionUnchecked(id)
    const user = await authorizeUploadKind(session.kind as UploadKind)
    return success(await assembleUploadSession(id, user.id))
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}
