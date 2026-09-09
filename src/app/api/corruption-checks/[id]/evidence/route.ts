import { z } from 'zod'
import { unlink } from 'node:fs/promises'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { success, notFound, error } from '@/lib/api-response'
import { CorruptionError, corruptionError } from '@/lib/corruption-server'
import { evidencePath } from '@/lib/corruption-evidence'
import { adoptUploadedFile } from '@/lib/upload-adopt'
import { consumeUploadSession, UploadSessionError } from '@/lib/upload-sessions'
import { randomUUID } from 'node:crypto'
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
    // Zwei Wege, ein Body: entweder ein bereits vorhandener Bodycam-Clip wird
    // verknuepft, oder eine ueber /api/uploads uebertragene Datei eingeloest.
    const body = z
      .union([
        z.object({ clipId: z.string().min(1).max(191) }).strict(),
        z.object({ uploadId: z.string().min(1).max(64), title: z.string().trim().min(1).max(200) }).strict(),
      ])
      .parse(await req.json())

    let data: { title: string; clipId?: string; filename?: string; sizeBytes?: number; mimeType?: string }
    if ('clipId' in body) {
      const access = await bodycamAccess()
      const clip = await prisma.bodycamClip.findFirst({ where: { id: body.clipId, investigation: access.where }, select: { id: true } })
      if (!clip) return notFound('Bodycam-Clip')
      data = { clipId: body.clipId, title: 'Bodycam-Verknüpfung' }
    } else {
      const file = await consumeUploadSession(body.uploadId, user.id, 'EVIDENCE', (source, extension) =>
        adoptUploadedFile(source, evidencePath(`${randomUUID()}${extension}`)),
      )
      stored = file.filename
      data = { title: body.title, filename: file.filename, sizeBytes: file.sizeBytes, mimeType: file.mimeType }
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
    if (cause instanceof UploadSessionError) return error(cause.message, cause.status)
    return corruptionError(cause)
  }
}
