import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { ORDNUNG_ICONS } from '@/lib/ordnungen-icons'

function slugify(input: string) {
  return input.trim().toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Volle Ordnung inkl. content — für den Editor (nur ordnungen:manage).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const { id } = await params
    const ordnung = await prisma.ordnung.findUnique({ where: { id } })
    if (!ordnung) return notFound('Ordnung')
    return success(ordnung)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const { id } = await params
    const body = await req.json()

    const data: Record<string, unknown> = {}
    if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim()
    if (typeof body.description === 'string') data.description = body.description.trim()
    if (typeof body.buttonLabel === 'string' && body.buttonLabel.trim()) data.buttonLabel = body.buttonLabel.trim()
    if (typeof body.icon === 'string' && body.icon in ORDNUNG_ICONS) data.icon = body.icon
    if (typeof body.content === 'string') data.content = body.content
    if (typeof body.slug === 'string' && body.slug.trim()) data.slug = slugify(body.slug)
    if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
    if (typeof body.categoryId === 'string' && body.categoryId) {
      const category = await prisma.ordnungCategory.findUnique({ where: { id: body.categoryId } })
      if (!category) return error('Kategorie nicht gefunden', 400)
      data.categoryId = body.categoryId
    }

    const ordnung = await prisma.ordnung.update({ where: { id }, data })
    return success(ordnung)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Eine Ordnung mit diesem Slug existiert bereits')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (msg.includes('Record to update not found')) return notFound('Ordnung')
    return error(msg, 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(['ADMIN'], ['ordnungen:manage'])
    const { id } = await params
    await prisma.ordnung.delete({ where: { id } })
    return success({ id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    if (msg.includes('Record to delete does not exist')) return notFound('Ordnung')
    return error(msg, 500)
  }
}
