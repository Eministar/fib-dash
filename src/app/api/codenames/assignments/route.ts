import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { codenameAgentSelect, formatCodename } from '@/lib/codenames'
import { codenameQuerySchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'
import { tokenizedWhere } from '@/lib/search-match'
import type { Prisma } from '@/generated/prisma/client'

export async function GET(req: Request) {
  try {
    await requirePermission('codenames:view')
    const { page, pageSize, search } = codenameQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
    // Zuweisungen findet man über den Decknamen UND über den Agent dahinter
    // (Name, Dienstnummer, Discord-ID) – jedes Suchwort muss irgendwo passen.
    const where: Prisma.CodenameWhereInput = {
      currentAgentId: { not: null },
      ...tokenizedWhere<Prisma.CodenameWhereInput>(search, (token) => [
        { name: { contains: token } },
        { currentAgent: { firstName: { contains: token } } },
        { currentAgent: { lastName: { contains: token } } },
        { currentAgent: { badgeNumber: { contains: token } } },
        { currentAgent: { discordId: { contains: token } } },
        { currentAgent: { user: { discordId: { contains: token } } } },
      ]),
    }
    const [items, total, prefix] = await Promise.all([
      prisma.codename.findMany({ where, include: { currentAgent: { select: codenameAgentSelect } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.codename.count({ where }), formatCodename(''),
    ])
    return success({ items, total, page, pageSize, prefix })
  } catch (cause) { return codenameRouteError(cause) }
}
