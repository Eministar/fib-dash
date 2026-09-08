import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success, error } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'

export async function GET(req: Request) {
  try {
    await requirePermission('investigations:view')
    const query = z.object({ search: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = query.search ? { title: { contains: query.search } } : {}
    const [items, total] = await Promise.all([
      prisma.investigationPhoto.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * 30, take: 30, select: { id: true, title: true, createdAt: true, sizeBytes: true } }),
      prisma.investigationPhoto.count({ where }),
    ])
    return success({ items: items.map(item => ({ ...item, url: `/api/investigations/photos/${item.id}/image` })), total, page: query.page })
  } catch (cause) { if (cause instanceof z.ZodError) return error('Ungültige Suchparameter'); return routeError(cause) }
}
