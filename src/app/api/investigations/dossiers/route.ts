import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { dossierRouteError, dossierSchema, saveDossier } from '@/lib/investigations/dossiers-server'
import { investigationVisibilityWhere } from '@/lib/investigations/investigations'
import { queueForumTask, syncDossierForum } from '@/lib/investigations/investigation-forum'
import { DOSSIER_SORTS, OPEN_INVESTIGATION_STATUSES } from '@/lib/investigations/dossiers'

const PAGE_SIZE = 30
// Das Register ist klein (Familien, nicht Einsätze). Für die Sortierung nach
// offenen Akten und letzter Aktivität wird deshalb im Speicher sortiert.
const MAX_REGISTER = 1000

export async function GET(req: Request) {
  try {
    const user = await requirePermission('investigations:view')
    const query = z.object({
      search: z.string().trim().max(200).default(''),
      sort: z.enum(Object.keys(DOSSIER_SORTS) as [keyof typeof DOSSIER_SORTS, ...(keyof typeof DOSSIER_SORTS)[]]).default('activity'),
      personId: z.string().max(191).optional(),
      investigationId: z.string().max(191).optional(),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    }).parse(Object.fromEntries(new URL(req.url).searchParams))
    const search = query.search
    const where = {
      ...(search ? { OR: [
        { title: { contains: search } },
        { address: { contains: search } },
        { leader: { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }] } },
        { persons: { some: { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }, { alias: { contains: search } }] } } },
      ] } : {}),
      ...(query.personId ? { persons: { some: { id: query.personId } } } : query.investigationId ? { investigations: { some: { id: query.investigationId } } } : {}),
    }
    const rows = await prisma.dossier.findMany({
      where,
      take: MAX_REGISTER,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: {
        photo: { select: { id: true, title: true } },
        leader: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, displayName: true } },
        investigations: { where: investigationVisibilityWhere(user), select: { status: true, updatedAt: true } },
        _count: { select: { persons: true, vehicles: true, mapSpots: true } },
      },
    })
    const open = new Set<string>(OPEN_INVESTIGATION_STATUSES)
    const enriched = rows.map(({ investigations, ...row }) => {
      const lastActivity = [row.updatedAt, ...investigations.map(item => item.updatedAt)].reduce((a, b) => (b > a ? b : a))
      return {
        ...row,
        lastActivityAt: lastActivity,
        openInvestigations: investigations.filter(item => open.has(item.status)).length,
        _count: { ...row._count, investigations: investigations.length },
      }
    })
    enriched.sort((a, b) =>
      query.sort === 'name' ? a.title.localeCompare(b.title, 'de')
        : query.sort === 'open' ? b.openInvestigations - a.openInvestigations || b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
          : b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
    const items = enriched.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE)
    return success({ items, total: enriched.length, page: query.page })
  } catch (cause) { return dossierRouteError(cause) }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    const dossier = await saveDossier(undefined, dossierSchema.parse(await req.json()), user)
    queueForumTask('Familienakte im Forum', () => syncDossierForum(dossier.id))
    return success(dossier, 201)
  } catch (cause) { return dossierRouteError(cause) }
}
