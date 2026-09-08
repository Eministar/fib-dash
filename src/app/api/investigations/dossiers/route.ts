import { z } from 'zod'
import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { dossierRouteError, dossierSchema, saveDossier } from '@/lib/dossiers-server'
import { investigationVisibilityWhere } from '@/lib/investigations'

export async function GET(req: Request) {
  try {
    const user = await requirePermission('investigations:view')
    const query = z.object({ search: z.string().trim().max(200).default(''), kind: z.enum(['FAMILY', 'COLLECTION', 'PROPERTY', 'FILE']).optional(), parentId: z.string().max(191).optional(), personId: z.string().max(191).optional(), investigationId: z.string().max(191).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(Object.fromEntries(new URL(req.url).searchParams))
    const where = {
      ...(query.search ? { title: { contains: query.search } } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.personId ? { persons: { some: { id: query.personId } } } : query.investigationId ? { investigations: { some: { id: query.investigationId } } } : query.parentId ? { parentId: query.parentId } : !query.kind && !query.search ? { parentId: null } : {}),
    }
    const [items, total] = await Promise.all([
      prisma.dossier.findMany({ where, take: 30, skip: (query.page - 1) * 30, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], include: { photo: { select: { id: true, title: true } }, parent: { select: { id: true, title: true } }, createdBy: { select: { id: true, displayName: true } }, _count: { select: { children: true, persons: true, vehicles: true, investigations: { where: investigationVisibilityWhere(user) }, clips: { where: { investigation: investigationVisibilityWhere(user) } } } } } }),
      prisma.dossier.count({ where }),
    ])
    return success({ items, total, page: query.page })
  } catch (cause) { return dossierRouteError(cause) }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('investigations:manage')
    return success(await saveDossier(undefined, dossierSchema.parse(await req.json()), user), 201)
  } catch (cause) { return dossierRouteError(cause) }
}
