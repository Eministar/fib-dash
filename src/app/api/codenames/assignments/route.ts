import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { codenameAgentSelect, formatCodename } from '@/lib/codenames'
import { codenameQuerySchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'

export async function GET(req: Request) {
  try {
    await requirePermission('codenames:view')
    const { page, pageSize, search } = codenameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = { currentAgentId: { not: null }, ...(search ? { name: { contains: search } } : {}) }
    const [items, total, prefix] = await Promise.all([
      prisma.codename.findMany({ where, include: { currentAgent: { select: codenameAgentSelect } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.codename.count({ where }), formatCodename(''),
    ])
    return success({ items, total, page, pageSize, prefix })
  } catch (cause) { return codenameRouteError(cause) }
}
