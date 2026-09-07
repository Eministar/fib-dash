import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { error, success, unauthorized } from '@/lib/api-response'
import { requireTaskModuleManage, requireTaskModuleView } from '@/lib/module-permissions'
import { deleteUploadedFile, saveUploadedFile, validateUploadFile } from '@/lib/uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const resourceInclude = {
  training: { select: { id: true, label: true, sortOrder: true } },
  createdBy: { select: { id: true, displayName: true } },
}

function text(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function uploadErrorStatus(message: string) {
  if (message.includes('leer')) return 400
  if (message.includes('zu groß')) return 413
  return 415
}

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
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireTaskModuleManage('ACADEMY')
    const form = await req.formData().catch(() => null)
    if (!form) return error('Multipart/Form-Data wird benötigt')

    const scope = text(form, 'scope')
    const type = text(form, 'type')
    const title = text(form, 'title')
    const description = text(form, 'description')
    const trainingId = text(form, 'trainingId')
    const customTrainingName = text(form, 'customTrainingName')

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
      const url = text(form, 'url')
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

    const file = form.get('file')
    if (!(file instanceof File)) return error('Datei ist erforderlich')
    const validationError = validateUploadFile(file)
    if (validationError) return error(validationError, uploadErrorStatus(validationError))

    const uploaded = await saveUploadedFile(file)
    try {
      const resource = await prisma.academyResource.create({
        data: {
          scope,
          type,
          title,
          description: description || null,
          trainingId: trainingId || null,
          customTrainingName: trainingId ? null : customTrainingName || null,
          url: uploaded.url,
          storedFilename: uploaded.filename,
          originalFilename: uploaded.originalName,
          mimeType: uploaded.mimeType,
          size: uploaded.size,
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
