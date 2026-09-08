import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { codenameAgentSelect, CodenameError } from '@/lib/codenames'
import { codenameQuerySchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('codenames:view')
    const { id } = await params
    if (!await prisma.codename.findUnique({ where: { id }, select: { id: true } })) throw new CodenameError('Deckname nicht gefunden', 404)
    const { page, pageSize } = codenameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = { codenameId: id }
    const [items, total] = await Promise.all([
      prisma.codenameAssignment.findMany({ where, include: { agent: { select: codenameAgentSelect }, assignedBy: { select: { displayName: true } }, releasedBy: { select: { displayName: true } } }, orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize }),
      prisma.codenameAssignment.count({ where }),
    ])
    return success({ items, total, page, pageSize })
  } catch (cause) { return codenameRouteError(cause) }
}
