import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { success, notFound } from '@/lib/api-response'
import { corruptionError, corruptionInclude } from '@/lib/corruption-server'
import { correctionSchema, correctReport } from '@/lib/corruption-edits'
type Context = { params: Promise<{ id: string }> }
export async function GET(_req: Request, { params }: Context) {
  try {
    await requireAuth()
    const check = await prisma.corruptionCheck.findUnique({ where: { id: (await params).id }, include: { ...corruptionInclude, revisions: { orderBy: { version: 'desc' } }, evidence: { orderBy: { createdAt: 'asc' }, select: { id: true, title: true, mimeType: true, sizeBytes: true, clipId: true, createdAt: true, uploadedByName: true } } } })
    return check ? success(check) : notFound('Bericht')
  } catch (cause) { return corruptionError(cause) }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    const user = await requireAuth()
    const input = correctionSchema.parse(await req.json())
    const { id } = await params
    return success(await prisma.$transaction(tx => correctReport(tx, id, input, user)))
  } catch (cause) { return corruptionError(cause) }
}
