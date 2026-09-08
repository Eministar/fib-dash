import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { codenameAgentSelect, createCodename, formatCodename } from '@/lib/codenames'
import { codenameQuerySchema, createCodenameSchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'
import type { Prisma } from '@/generated/prisma'

export async function GET(req: Request) {
  try {
    await requirePermission('codenames:view')
    const query = codenameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where: Prisma.CodenameWhereInput = {
      ...(query.search ? { name: { contains: query.search } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status === 'free' ? { retired: false, currentAgentId: null } : {}),
      ...(query.status === 'assigned' ? { currentAgentId: { not: null } } : {}),
      ...(query.status === 'retired' ? { retired: true } : {}),
    }
    const [items, total, categories, prefix] = await Promise.all([
      prisma.codename.findMany({ where, include: { currentAgent: { select: codenameAgentSelect }, _count: { select: { assignments: true } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.codename.count({ where }),
      prisma.codename.findMany({ distinct: ['category'], select: { category: true }, where: { category: { not: null } }, orderBy: { category: 'asc' } }),
      formatCodename(''),
    ])
    return success({ items, total, page: query.page, pageSize: query.pageSize, categories: categories.map(row => row.category), prefix })
  } catch (cause) { return codenameRouteError(cause) }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('codenames:manage')
    return success(await createCodename(createCodenameSchema.parse(await req.json()), user.id), 201)
  } catch (cause) { return codenameRouteError(cause) }
}
