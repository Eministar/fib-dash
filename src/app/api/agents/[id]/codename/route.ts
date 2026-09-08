import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { CodenameError, formatCodename } from '@/lib/codenames'
import { codenameQuerySchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('codenames:view')
    const { id } = await params
    const agent = await prisma.agent.findUnique({ where: { id }, select: { codename: true } })
    if (!agent) throw new CodenameError('Agent nicht gefunden', 404)
    const { page, pageSize } = codenameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = { agentId: id }
    const [items, total, prefix] = await Promise.all([
      prisma.codenameAssignment.findMany({ where, include: { codename: { select: { id: true, name: true } }, assignedBy: { select: { displayName: true } }, releasedBy: { select: { displayName: true } } }, orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize }),
      prisma.codenameAssignment.count({ where }), formatCodename(''),
    ])
    return success({ current: agent.codename, items, total, page, pageSize, prefix })
  } catch (cause) { return codenameRouteError(cause) }
}
