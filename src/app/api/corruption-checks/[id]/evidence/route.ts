import { z } from 'zod'
import { unlink } from 'node:fs/promises'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { success, notFound } from '@/lib/api-response'
import { CorruptionError, corruptionError } from '@/lib/corruption-server'
import { evidencePath, saveEvidence } from '@/lib/corruption-evidence'
import { bodycamAccess } from '@/lib/bodycam-access'
import { createAuditLog } from '@/lib/audit'
import { uploadCors, uploadOptions } from '@/lib/upload-cors'

export const OPTIONS = uploadOptions
type Context = { params: Promise<{ id: string }> }
export async function POST(req: Request, context: Context) { return uploadCors(req, await uploadEvidence(req, context)) }

async function uploadEvidence(req: Request, { params }: Context) {
  let stored: string | undefined
  try {
    const user = await requireAuth()
    const { id: checkId } = await params
    if (!await prisma.corruptionCheck.findUnique({ where: { id: checkId }, select: { id: true } })) return notFound('Bericht')
    const type = req.headers.get('content-type')?.split(';')[0] ?? ''
    let data: { title: string; clipId?: string; filename?: string; sizeBytes?: number; mimeType?: string }
    if (type === 'application/json') {
      const { clipId } = z.object({ clipId: z.string().min(1).max(191) }).strict().parse(await req.json())
      const access = await bodycamAccess()
      const clip = await prisma.bodycamClip.findFirst({ where: { id: clipId, investigation: access.where }, select: { id: true } })
      if (!clip) return notFound('Bodycam-Clip')
      data = { clipId, title: 'Bodycam-Verknüpfung' }
    } else {
      if (!req.body) throw new CorruptionError('Datei fehlt')
      const title = z.string().trim().min(1).max(200).parse(decodeURIComponent(req.headers.get('x-evidence-title') ?? ''))
      const expected = req.headers.get('x-upload-size') ?? req.headers.get('content-length')
      const file = await saveEvidence(req.body, type, expected === null ? undefined : Number(expected))
      stored = file.filename
      data = { ...file, title }
    }
    const evidence = await prisma.$transaction(async tx => {
      const created = await tx.corruptionEvidence.create({ data: { ...data, checkId, uploadedById: user.id, uploadedByName: user.displayName } })
      await createAuditLog({ action: 'CORRUPTION_EVIDENCE_ADDED', userId: user.id, details: `${checkId}: ${data.title}` }, tx)
      return created
    })
    stored = undefined
    return success({ id: evidence.id }, 201)
  } catch (cause) {
    if (stored) {
      // Only remove after the database confirms the failed transaction did not commit.
      try { if (!await prisma.corruptionEvidence.findUnique({ where: { filename: stored } })) await unlink(evidencePath(stored)) } catch { /* Leave possibly referenced bytes intact. */ }
    }
    return corruptionError(cause)
  }
}
