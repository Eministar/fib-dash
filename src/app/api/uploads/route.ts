import { NextRequest } from 'next/server'
import { z } from 'zod'

import { error, success } from '@/lib/api-response'
import { routeError } from '@/lib/investigations-server'
import { authorizeUploadKind } from '@/lib/upload-authorization'
import { openUploadSession, UploadSessionError, type UploadKind } from '@/lib/upload-sessions'

export const dynamic = 'force-dynamic'

const schema = z
  .object({
    kind: z.enum(['CLIP', 'EVIDENCE', 'PHOTO', 'RESOURCE']),
    originalName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(120),
    totalBytes: z.number().int().positive(),
    fingerprint: z.string().trim().min(1).max(120),
  })
  .strict()

/**
 * Legt eine Upload-Sitzung an — oder liefert die angefangene zurück, wenn
 * dieselbe Datei schon einmal begonnen wurde. Der Browser muss sich dafür
 * nichts merken; der Fingerabdruck der Datei genügt.
 */
export async function POST(req: NextRequest) {
  try {
    const input = schema.parse(await req.json())
    const kind = input.kind as UploadKind
    const user = await authorizeUploadKind(kind)
    const session = await openUploadSession({ ...input, kind, ownerId: user.id })
    return success(session, session.resumed ? 200 : 201)
  } catch (cause) {
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    // Eine fehlerhafte Anfrage ist kein Serverfehler. Ohne diesen Zweig
    // landete der rohe Zod-Dump als HTTP 500 im Upload-Dialog.
    if (cause instanceof z.ZodError) {
      return error(`Ungültige Upload-Anfrage: ${cause.issues.map((issue) => issue.message).join(' ')}`, 400)
    }
    return routeError(cause)
  }
}
