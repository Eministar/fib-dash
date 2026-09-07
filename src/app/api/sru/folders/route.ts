import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { taskModuleOrNull, requireTaskModuleManage, requireTaskModuleView } from '@/lib/module-permissions'

const folderInclude = {
  createdBy: { select: { id: true, displayName: true } },
  documents: {
    orderBy: [{ sortOrder: 'asc' as const }, { updatedAt: 'desc' as const }],
    include: {
      createdBy: { select: { id: true, displayName: true } },
      updatedBy: { select: { id: true, displayName: true } },
    },
  },
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanColor(value: unknown) {
  if (typeof value !== 'string') return '#d4d4d4'
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#d4d4d4'
}

export async function GET(req: NextRequest) {
  const targetModule = taskModuleOrNull(req.nextUrl.searchParams.get('module')) ?? 'SRU'

  try {
    await requireTaskModuleView(targetModule)
    const folders = await prisma.sruFolder.findMany({
      where: { module: targetModule },
      include: folderInclude,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    const looseDocuments = await prisma.sruDocument.findMany({
      where: { module: targetModule, folderId: null },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, displayName: true } },
        updatedBy: { select: { id: true, displayName: true } },
      },
    })

    return success({ folders, looseDocuments })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const targetModule = taskModuleOrNull(body.module) ?? 'SRU'
    const user = await requireTaskModuleManage(targetModule)
    const name = cleanText(body.name)
    if (!name) return error('Name ist erforderlich')

    const last = await prisma.sruFolder.findFirst({
      where: { module: targetModule },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const folder = await prisma.sruFolder.create({
      data: {
        module: targetModule,
        name,
        description: cleanText(body.description) || null,
        color: cleanColor(body.color),
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: user.id,
      },
      include: folderInclude,
    })

    return success(folder, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const id = cleanText(body.id)
    if (!id) return error('Ordner-ID ist erforderlich')

    const existing = await prisma.sruFolder.findUnique({ where: { id } })
    if (!existing) return notFound('Ordner')
    await requireTaskModuleManage(existing.module)

    const data: Record<string, unknown> = {}
    if ('name' in body) {
      const name = cleanText(body.name)
      if (!name) return error('Name darf nicht leer sein')
      data.name = name
    }
    if ('description' in body) data.description = cleanText(body.description) || null
    if ('color' in body) data.color = cleanColor(body.color)
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

    const folder = await prisma.sruFolder.update({
      where: { id },
      data,
      include: folderInclude,
    })

    return success(folder)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
