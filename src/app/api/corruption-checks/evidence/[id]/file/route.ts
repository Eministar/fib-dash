import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from '@/lib/api-response'
import { corruptionError } from '@/lib/corruption-server'
import { evidenceResponse } from '@/lib/corruption-evidence'
import { bodycamAccess } from '@/lib/bodycam-access'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const evidence = await prisma.corruptionEvidence.findUnique({ where: { id: (await params).id } })
    if (!evidence) return notFound('Beweis')
    if (evidence.clipId) {
      const access = await bodycamAccess()
      if (!await prisma.bodycamClip.findFirst({ where: { id: evidence.clipId, investigation: access.where }, select: { id: true } })) return notFound('Bodycam-Clip')
      return new Response(null, { status: 307, headers: { Location: `/api/investigations/clips/${evidence.clipId}/stream`, 'Cache-Control': 'private, no-store' } })
    }
    if (!evidence.filename || !evidence.mimeType) return notFound('Datei')
    return await evidenceResponse(evidence.filename, evidence.mimeType, req.headers.get('range'))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return notFound('Datei')
    return corruptionError(cause)
  }
}
