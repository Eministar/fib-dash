import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { corruptionQuerySchema } from '@/lib/corruption-validation'
import { corruptionError, officialSearch } from '@/lib/corruption-server'

export async function GET(req: Request) {
  try {
    await requireAuth()
    const q = corruptionQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = { mergedIntoId: null, AND: [{ OR: [officialSearch(q.search), { mergedFrom: { some: officialSearch(q.search) } }] }, ...(q.agency ? [{ agency: { contains: q.agency } }] : [])] }
    const [items, total] = await Promise.all([
      prisma.publicOfficial.findMany({ where, take: 25, skip: (q.page - 1) * 25, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], include: { _count: { select: { checks: true } }, checks: { select: { conductedAt: true, result: true }, orderBy: { conductedAt: 'desc' }, take: 1 } } }),
      prisma.publicOfficial.count({ where }),
    ])
    return success({ items, total, page: q.page })
  } catch (cause) { return corruptionError(cause) }
}
