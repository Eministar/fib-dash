import { z } from 'zod'
import { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { requirePermission } from './auth'
import { createAuditLog } from './audit'
import { error, forbidden, unauthorized } from './api-response'
import { investigationVisibilityWhere } from './investigations'

const id = z.string().trim().min(1).max(191)
export const dossierSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['FAMILY', 'COLLECTION', 'PROPERTY', 'FILE']),
  description: z.string().trim().max(30000).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  photoId: id.nullable().optional(),
  parentId: id.nullable().optional(),
  personIds: z.array(id).max(200).optional(),
  investigationIds: z.array(id).max(200).optional(),
}).strict()

export class DossierError extends Error {
  constructor(message: string, readonly status = 409) { super(message) }
}

export function dossierRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof DossierError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map(issue => issue.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültiges JSON')
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    if (cause.code === 'P2025') return error('Akte nicht gefunden', 404)
    if (['P2003', 'P2014', 'P2034'].includes(cause.code)) return error('Akte ist verknüpft oder wurde gleichzeitig geändert. Bitte neu laden.', 409)
  }
  console.error('[Dossiers]', cause)
  return error('Aktion konnte nicht abgeschlossen werden', 500)
}

export async function validateDossierParent(id: string | undefined, parentId: string | null | undefined, getParent: (id: string) => Promise<{ parentId: string | null } | null>) {
  const visited = new Set<string>()
  let current = parentId
  while (current) {
    if (current === id || visited.has(current)) throw new DossierError('Eine Akte darf nicht unter sich selbst oder einer ihrer Unterakten liegen')
    if (visited.size >= 30) throw new DossierError('Maximal 30 Ebenen für Unterakten erlaubt')
    visited.add(current)
    const parent = await getParent(current)
    if (!parent) throw new DossierError('Übergeordnete Akte nicht gefunden', 404)
    current = parent.parentId
  }
}

export async function saveDossier(id: string | undefined, input: z.infer<typeof dossierSchema> | z.infer<ReturnType<typeof dossierSchema.partial>>, user: Awaited<ReturnType<typeof requirePermission>>) {
  return prisma.$transaction(async tx => {
    const existing = id ? await tx.dossier.findUnique({ where: { id } }) : null
    if (id && !existing) throw new DossierError('Akte nicht gefunden', 404)
    if (input.parentId !== undefined) await validateDossierParent(id, input.parentId, parentId => tx.dossier.findUnique({ where: { id: parentId }, select: { parentId: true } }))
    if (input.photoId && !await tx.investigationPhoto.findUnique({ where: { id: input.photoId }, select: { id: true } })) throw new DossierError('Bild nicht gefunden', 404)
    const personIds = input.personIds ? [...new Set(input.personIds)] : undefined
    if (personIds && await tx.person.count({ where: { id: { in: personIds } } }) !== personIds.length) throw new DossierError('Person nicht gefunden', 404)
    const investigationIds = input.investigationIds ? [...new Set(input.investigationIds)] : undefined
    if (investigationIds && await tx.investigation.count({ where: { AND: [investigationVisibilityWhere(user), { id: { in: investigationIds } }] } }) !== investigationIds.length) throw new DossierError('Einsatzakte nicht verfügbar', 404)
    // Updating visible links must not disconnect classified cases hidden from this user.
    const visibleLinks = id && investigationIds ? await tx.investigation.findMany({ where: { AND: [investigationVisibilityWhere(user), { dossiers: { some: { id } } }] }, select: { id: true } }) : []
    const { personIds: _persons, investigationIds: _investigations, ...fields } = input
    void _persons; void _investigations
    const relations = {
      ...(personIds ? { persons: { set: personIds.map(id => ({ id })) } } : {}),
      ...(investigationIds ? { investigations: { disconnect: visibleLinks, connect: investigationIds.map(id => ({ id })) } } : {}),
    }
    const dossier = id
      ? await tx.dossier.update({ where: { id }, data: { ...fields, ...relations } })
      : await tx.dossier.create({ data: {
          ...fields, title: input.title!, kind: input.kind!, createdById: user.id,
          persons: { connect: (personIds ?? []).map(id => ({ id })) },
          investigations: { connect: (investigationIds ?? []).map(id => ({ id })) },
        } })
    await createAuditLog({ action: id ? 'DOSSIER_UPDATED' : 'DOSSIER_CREATED', userId: user.id, oldValue: existing ? JSON.stringify(existing) : undefined, newValue: JSON.stringify(dossier) }, tx)
    return dossier
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
