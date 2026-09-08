import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { corruptionCheckSchema, corruptionQuerySchema } from '@/lib/corruption-validation'
import { corruptionError, corruptionInclude, officialSearch, saveCorruptionCheck } from '@/lib/corruption-server'
import type { Prisma } from '@/generated/prisma'

export async function GET(req: Request) {
  try {
    await requireAuth()
    const q = corruptionQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where: Prisma.CorruptionCheckWhereInput = {
      ...(q.officialId ? { officialId: q.officialId } : {}),
      ...(q.result ? { result: q.result } : {}),
      ...(q.agentId ? { agents: { some: { agentId: q.agentId } } } : {}),
      ...(q.from || q.to ? { conductedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
      AND: [
        ...(q.agency ? [{ official: { agency: { contains: q.agency } } }] : []),
        ...(q.search ? [{ OR: [{ official: officialSearch(q.search) }, { findings: { contains: q.search } }, { location: { contains: q.search } }] }] : []),
      ],
    }
    const [items, total] = await Promise.all([
      prisma.corruptionCheck.findMany({ where, include: corruptionInclude, take: 25, skip: (q.page - 1) * 25, orderBy: [{ conductedAt: q.order === 'oldest' ? 'asc' : 'desc' }, { id: 'desc' }] }),
      prisma.corruptionCheck.count({ where }),
    ])
    return success({ items, total, page: q.page })
  } catch (cause) { return corruptionError(cause) }
}

export async function POST(req: Request) {
  try {
    const user = await requireAuth()
    return success(await saveCorruptionCheck(corruptionCheckSchema.parse(await req.json()), user.id), 201)
  } catch (cause) { return corruptionError(cause) }
}
