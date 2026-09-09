import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import { authorizeUploadKind } from '@/lib/upload-authorization'
import {
  cancelUploadSession,
  loadOwnedSessionUnchecked,
  UploadSessionError,
  type UploadKind,
} from '@/lib/upload-sessions'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** Bricht einen laufenden Upload ab und räumt die Teildateien weg. */
export async function DELETE(_req: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const session = await loadOwnedSessionUnchecked(id)
    const user = await authorizeUploadKind(session.kind as UploadKind)
    await cancelUploadSession(id, user.id)
    return success({ cancelled: true })
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}
