import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { requireTaskModuleManage } from '@/lib/module-permissions'

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const existing = await prisma.sruDocument.findUnique({ where: { id } })
    if (!existing) return notFound('Dokument')
    const user = await requireTaskModuleManage(existing.module)

    const data: Record<string, unknown> = { updatedById: user.id }
    if ('title' in body) {
      const title = cleanText(body.title)
      if (!title) return error('Titel ist erforderlich')
      data.title = title
    }
    if ('content' in body) data.content = typeof body.content === 'string' ? body.content : ''
    if ('externalUrl' in body) {
      const externalUrl = normalizeExternalUrl(body.externalUrl)
      if (externalUrl === undefined) return error('Gültiger HTTP- oder HTTPS-Link ist erforderlich')
      data.externalUrl = externalUrl
    }
    if ('folderId' in body) {
      const folderId = cleanText(body.folderId)
      if (folderId) {
        const folder = await prisma.sruFolder.findFirst({ where: { id: folderId, module: existing.module }, select: { id: true } })
        if (!folder) return error('Ordner nicht gefunden', 404)
      }
      data.folderId = folderId || null
    }
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

    const document = await prisma.sruDocument.update({
      where: { id },
      data,
      include: documentInclude,
    })

    return success(document)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const document = await prisma.sruDocument.findUnique({ where: { id } })
    if (!document) return notFound('Dokument')
    await requireTaskModuleManage(document.module)

    await prisma.sruDocument.delete({ where: { id } })
    return success({ message: 'Dokument gelöscht' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
