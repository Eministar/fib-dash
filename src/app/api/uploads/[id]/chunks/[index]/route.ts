import { NextRequest } from 'next/server'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'
import { authorizeUploadKind } from '@/lib/upload-authorization'
import {
  loadOwnedSession,
  loadOwnedSessionUnchecked,
  receivedChunkIndexes,
  storeChunk,
  UploadSessionError,
  type UploadKind,
} from '@/lib/upload-sessions'

export const dynamic = 'force-dynamic'
export const OPTIONS = uploadOptions

type Context = { params: Promise<{ id: string; index: string }> }

export async function PUT(req: NextRequest, context: Context) {
  return uploadCors(req, await storeOne(req, context))
}

/**
 * Nimmt genau einen Chunk entgegen. Das ist der einzige Request, der noch
 * gross wird — deshalb läuft er am Body-klonenden Proxy vorbei (`src/proxy.ts`).
 */
async function storeOne(req: NextRequest, context: Context) {
  try {
    const { id, index: rawIndex } = await context.params

    // Die Art steht in der Sitzung; erst danach lässt sich die zuständige
    // Berechtigung bestimmen. Die Besitzerprüfung folgt unmittelbar, bevor
    // auch nur ein Byte auf unsere Platte geschrieben wird.
    const unchecked = await loadOwnedSessionUnchecked(id)
    const user = await authorizeUploadKind(unchecked.kind as UploadKind)
    const session = await loadOwnedSession(id, user.id)

    if (session.status !== 'OPEN') return error('Der Upload ist nicht mehr offen', 409)

    const index = Number.parseInt(rawIndex, 10)
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.chunkCount) {
      return error('Ungültiger Chunk-Index')
    }

    if (!req.body) return error('Es wurden keine Daten übertragen')

    const isLast = index === session.chunkCount - 1
    const expectedBytes = isLast
      ? Number(session.totalBytes) - session.chunkSize * index
      : session.chunkSize

    await storeChunk(session.id, index, req.body, req.headers.get('x-chunk-sha256') ?? '', expectedBytes)

    const received = await receivedChunkIndexes(session.id)
    return success({ received: received.length, chunkCount: session.chunkCount })
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return routeError(cause)
  }
}
