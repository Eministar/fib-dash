import { NextRequest } from 'next/server'

import { forbidden, notFound } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { clipFileResponse } from '@/lib/clips'
import { prisma } from '@/lib/prisma'
import { canAccessInvestigation } from '@/lib/investigations'
import { routeError } from '@/lib/investigations-server'

export const dynamic = 'force-dynamic'

/**
 * Liefert die Videodatei aus. Der Zugriffsschutz ist hier genauso streng wie
 * auf der Akte selbst – die Datei liegt bewusst außerhalb von `public/`, damit
 * es keinen ungeprüften Weg an dieser Route vorbei gibt.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('investigations:view')
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
            assignees: { select: { userId: true } },
          },
        },
      },
    })
    if (!clip) return notFound('Clip')
    if (!canAccessInvestigation(user, clip.investigation)) return forbidden()

    return await clipFileResponse(clip.filename, clip.mimeType, req.headers.get('range'))
  } catch (cause: unknown) {
    if (cause instanceof Error && 'code' in cause && (cause as { code?: string }).code === 'ENOENT') {
      return notFound('Videodatei')
    }
    return routeError(cause)
  }
}
