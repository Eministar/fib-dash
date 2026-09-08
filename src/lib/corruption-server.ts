import { z } from 'zod'
import { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { createAuditLog } from './audit'
import { error, unauthorized, forbidden } from './api-response'
import { officialNumber, parseOfficialNumber, type CorruptionInput } from './corruption-validation'

export const corruptionInclude = {
  official: true,
  agents: { orderBy: { name: 'asc' as const } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.CorruptionCheckInclude

export class CorruptionError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export function corruptionError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034') return error('Gleichzeitig geändert. Bitte neu laden und erneut versuchen.', 409)
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof CorruptionError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map(i => i.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe')
  console.error('[CorruptionChecks]', cause)
  return error('Korruptionskontrolle konnte nicht verarbeitet werden', 500)
}

export function officialSearch(search: string): Prisma.PublicOfficialWhereInput {
  const number = parseOfficialNumber(search)
  if (number) return { id: number }
  return { AND: search.split(/\s+/).filter(Boolean).map(word => ({ OR: [
    { firstName: { contains: word } }, { lastName: { contains: word } },
    { agency: { contains: word } }, { badgeNumber: { contains: word } },
  ] })) }
}

export async function createCorruptionCheck(tx: Prisma.TransactionClient, input: CorruptionInput, userId: string) {
  const existing = await tx.corruptionCheck.findUnique({ where: { requestId: input.requestId }, include: corruptionInclude })
  if (existing) {
    if (existing.createdById !== userId) throw new CorruptionError('Anfragekennung bereits verwendet', 409)
    return existing
  }
  const agents = await tx.agent.findMany({ where: { id: { in: input.agentIds } }, select: { id: true, firstName: true, lastName: true, badgeNumber: true } })
  if (agents.length !== input.agentIds.length) throw new CorruptionError('Ein ausgewählter Agent existiert nicht mehr. Bitte Auswahl aktualisieren.')
  const official = input.officialId
    ? await resolveOfficial(tx, input.officialId)
    : await tx.publicOfficial.create({ data: input.official! })
  if (!official) throw new CorruptionError('Beamtenakte nicht gefunden', 404)
  const check = await tx.corruptionCheck.create({ data: {
    requestId: input.requestId, officialId: official.id, conductedAt: new Date(input.conductedAt),
    result: input.result, findings: input.findings || 'Ohne Befund',
    location: input.location || null, notes: input.notes || null, createdById: userId,
    agents: { create: agents.map(agent => ({ agentId: agent.id, name: `${agent.firstName} ${agent.lastName}`, badgeNumber: agent.badgeNumber })) },
  }, include: corruptionInclude })
  await createAuditLog({ action: 'CORRUPTION_CHECK_CREATED', userId, details: `Korruptionskontrolle ${check.id} für ${officialNumber(official.id)}: ${official.firstName} ${official.lastName}`, newValue: JSON.stringify(check) }, tx)
  return check
}

export async function saveCorruptionCheck(input: CorruptionInput, userId: string) {
  try { return await prisma.$transaction(tx => createCorruptionCheck(tx, input, userId), { isolationLevel: 'Serializable' }) }
  catch (cause) {
    // Concurrent retries roll back their new official before returning the first result.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      const saved = await prisma.corruptionCheck.findUnique({ where: { requestId: input.requestId }, include: corruptionInclude })
      if (saved?.createdById === userId) return saved
    }
    throw cause
  }
}

export async function resolveOfficial(tx: Pick<Prisma.TransactionClient, 'publicOfficial'>, id: number) {
  const visited = new Set<number>()
  let person = await tx.publicOfficial.findUnique({ where: { id } })
  while (person?.mergedIntoId) {
    if (visited.has(person.id)) throw new CorruptionError('Ungültiger Aktenverweis', 409)
    visited.add(person.id)
    person = await tx.publicOfficial.findUnique({ where: { id: person.mergedIntoId } })
  }
  return person
}
