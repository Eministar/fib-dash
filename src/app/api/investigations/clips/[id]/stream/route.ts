import { NextRequest } from 'next/server'

import { forbidden, notFound } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { bodycamAccess, canAccessBodycamClip, canViewAgentRecordClip, isAgentRecordClip } from '@/lib/investigations/bodycam-access'
import { clipFileResponse } from '@/lib/media/clips'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Liefert die Videodatei aus. Der Zugriffsschutz ist derselbe wie im Katalog
 * (`canAccessBodycamClip`) – die Datei liegt bewusst außerhalb von `public/`,
 * damit es keinen ungeprüften Weg an dieser Route vorbei gibt. Clips aus einer
 * Agent-Akte brauchen stattdessen die Rechte der Agent-Akte.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Erst anmelden, dann suchen: Ohne Login verrät die Antwort nicht, ob es den Clip gibt.
    const user = await requireAuth()
    const { id } = await params

    const clip = await prisma.bodycamClip.findUnique({
      where: { id },
      select: { filename: true, mimeType: true, investigationId: true, agentRecordEntryId: true },
    })
    if (!clip) return notFound('Clip')
    if (isAgentRecordClip(clip)) {
      if (!canViewAgentRecordClip(user)) return forbidden()
    } else if (!canAccessBodycamClip(await bodycamAccess())) {
      return forbidden()
    }

    const response = await clipFileResponse(clip.filename, clip.mimeType, req.headers.get('range'))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (cause: unknown) {
    if (cause instanceof Error && 'code' in cause && (cause as { code?: string }).code === 'ENOENT') {
      return notFound('Videodatei')
    }
    return routeError(cause)
  }
}
