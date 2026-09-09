import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { error, success, unauthorized } from '@/lib/api-response'
import { requireTaskModuleManage, requireTaskModuleView } from '@/lib/module-permissions'
import { deleteUploadedFile, resolveUploadPath } from '@/lib/uploads'
import { adoptUploadedFile } from '@/lib/upload-adopt'
import { consumeUploadSession, UploadSessionError } from '@/lib/upload-sessions'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const resourceInclude = {
  training: { select: { id: true, label: true, sortOrder: true } },
  createdBy: { select: { id: true, displayName: true } },
}

const bodySchema = z
  .object({
    scope: z.string().trim(),
    type: z.string().trim(),
    title: z.string().trim(),
    description: z.string().trim().max(5000).nullish(),
    trainingId: z.string().trim().max(64).nullish(),
    customTrainingName: z.string().trim().max(200).nullish(),
    url: z.string().trim().max(2000).nullish(),
    uploadId: z.string().trim().max(64).nullish(),
  })
  .strict()

function validExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET() {
  try {
    await requireTaskModuleView('ACADEMY')
    const [resources, trainings] = await Promise.all([
      prisma.academyResource.findMany({
        include: resourceInclude,
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.training.findMany({
        select: { id: true, label: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ])
    return success({ resources, trainings })
  } catch (e: unknown) {
    if (e instanceof UploadSessionError) return error(e.message, e.status)
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireTaskModuleManage('ACADEMY')
    // Die Datei ist bereits ueber /api/uploads eingetroffen und geprueft;
    // hier reisen nur noch die Angaben zur Ressource plus das Ticket.
    const body = bodySchema.parse(await req.json())

    const scope = body.scope
    const type = body.type
    const title = body.title
    const description = body.description ?? ''
    const trainingId = body.trainingId ?? ''
    const customTrainingName = body.customTrainingName ?? ''

    if (scope !== 'GENERAL' && scope !== 'TRAINING') return error('Ungültiger Ressourcenbereich')
    if (type !== 'FILE' && type !== 'LINK') return error('Ungültiger Ressourcentyp')
    if (!title) return error('Titel ist erforderlich')
    if (scope === 'GENERAL' && type !== 'FILE') return error('In der Dateiablage sind nur Dateien erlaubt')
    if (scope === 'TRAINING' && !trainingId && !customTrainingName) {
      return error('Ausbildung oder eigene Kategorie ist erforderlich')
    }

    if (trainingId) {
      const training = await prisma.training.findUnique({ where: { id: trainingId }, select: { id: true } })
      if (!training) return error('Ausbildung nicht gefunden', 404)
    }

    if (type === 'LINK') {
      const url = body.url ?? ''
      if (!validExternalUrl(url)) return error('Gültiger HTTP- oder HTTPS-Link ist erforderlich')

      const resource = await prisma.academyResource.create({
        data: {
          scope,
          type,
          title,
          description: description || null,
          trainingId: trainingId || null,
          customTrainingName: trainingId ? null : customTrainingName || null,
          url,
          createdById: user.id,
        },
        include: resourceInclude,
      })
      return success(resource, 201)
    }

    if (!body.uploadId) return error('Datei ist erforderlich')

    const uploaded = await consumeUploadSession(body.uploadId, user.id, 'RESOURCE', (source, extension) =>
      adoptUploadedFile(source, resolveUploadPath(`${randomUUID()}${extension}`)),
    )
    try {
      const resource = await prisma.academyResource.create({
        data: {
          scope,
          type,
          title,
          description: description || null,
          trainingId: trainingId || null,
          customTrainingName: trainingId ? null : customTrainingName || null,
          url: `/uploads/${uploaded.filename}`,
          storedFilename: uploaded.filename,
          originalFilename: uploaded.originalName,
          mimeType: uploaded.mimeType,
          size: uploaded.sizeBytes,
          createdById: user.id,
        },
        include: resourceInclude,
      })
      return success(resource, 201)
    } catch (e) {
      await deleteUploadedFile(uploaded.filename).catch(() => undefined)
      throw e
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
