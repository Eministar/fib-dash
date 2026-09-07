import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { ORDNUNG_ICONS } from '@/lib/ordnungen-icons'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if (typeof body.label === 'string' && body.label.trim()) data.label = body.label.trim()
    if (typeof body.description === 'string') data.description = body.description.trim() || null
    if (typeof body.icon === 'string' && body.icon in ORDNUNG_ICONS) data.icon = body.icon
    if (typeof body.color === 'string' && body.color) data.color = body.color
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

    const category = await prisma.ordnungCategory.update({ where: { id }, data })
    return success(category)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Kategorie existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (msg.includes('Record to update not found')) return notFound('Kategorie')
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const { id } = await params

    const count = await prisma.ordnung.count({ where: { categoryId: id } })
    if (count > 0) return error('Kategorie enthält noch Ordnungen und kann nicht gelöscht werden', 409)

    await prisma.ordnungCategory.delete({ where: { id } })
    return success({ id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (msg.includes('Record to delete does not exist')) return notFound('Kategorie')
    return error(msg, 500)
  }
}
