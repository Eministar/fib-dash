import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized } from '@/lib/api-response'
import { taskModuleOrNull, requireTaskModuleManage } from '@/lib/module-permissions'

const documentInclude = {
  folder: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Nur sichere externe Ziele speichern; leere Eingaben entfernen den Link. */
function normalizeExternalUrl(value: unknown): string | null | undefined {
  const raw = cleanText(value)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const targetModule = taskModuleOrNull(body.module) ?? 'SRU'
    const user = await requireTaskModuleManage(targetModule)
    const title = cleanText(body.title)
    const folderId = cleanText(body.folderId)
    if (!title) return error('Titel ist erforderlich')
    const externalUrl = normalizeExternalUrl(body.externalUrl)
    if (externalUrl === undefined) return error('Gültiger HTTP- oder HTTPS-Link ist erforderlich')

    if (folderId) {
      const folder = await prisma.sruFolder.findFirst({ where: { id: folderId, module: targetModule }, select: { id: true } })
      if (!folder) return error('Ordner nicht gefunden', 404)
    }

    const last = await prisma.sruDocument.findFirst({
      where: { module: targetModule, folderId: folderId || null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    const document = await prisma.sruDocument.create({
      data: {
        module: targetModule,
        folderId: folderId || null,
        title,
        content: typeof body.content === 'string' ? body.content : '',
        externalUrl,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
      include: documentInclude,
    })

    return success(document, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
