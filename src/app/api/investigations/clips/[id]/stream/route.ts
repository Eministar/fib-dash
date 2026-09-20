import { NextRequest } from 'next/server'

import { forbidden, notFound } from '@/lib/api-response'
import { bodycamAccess, canAccessBodycamClip } from '@/lib/bodycam-access'
import { clipFileResponse } from '@/lib/clips'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Liefert die Videodatei aus. Der Zugriffsschutz ist derselbe wie im Katalog
 * (`canAccessBodycamClip`) – die Datei liegt bewusst außerhalb von `public/`,
 * damit es keinen ungeprüften Weg an dieser Route vorbei gibt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await bodycamAccess()
    const { id } = await params

    const clip = await prisma.bodycamClip.findUnique({
      where: { id },
      select: {
        filename: true,
        mimeType: true,
        investigation: {
          select: {
            classified: true,
            createdById: true,
            leadAgent: { select: { discordId: true } },
            assignees: { select: { agent: { select: { discordId: true } } } },
          },
        },
      },
    })
    if (!clip) return notFound('Clip')
    if (!canAccessBodycamClip(access, clip.investigation)) return forbidden()

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
