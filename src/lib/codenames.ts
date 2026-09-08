import { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit'
import { queueCodenameBoardUpdate } from '@/lib/discord-integration'
import { z } from 'zod'
import { createCodenameSchema, updateCodenameSchema } from './codename-validation'

export class CodenameError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}

export const codenameAgentSelect = { id: true, firstName: true, lastName: true, badgeNumber: true } as const

export async function formatCodename(name: string) {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'codenames.prefix' } })
  return [setting?.value.trim() ?? 'Agent', name].filter(Boolean).join(' ')
}

// Serializable reads protect the history as well as the unique holder column.
// Deadlocks are expected when two officers concurrently swap aliases.
export async function codenameTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034' && attempt < 3) continue
      throw cause
    }
  }
}

async function findCodename(tx: Prisma.TransactionClient, id: string) {
  const entry = await tx.codename.findUnique({ where: { id }, include: { currentAgent: { select: codenameAgentSelect } } })
  if (!entry) throw new CodenameError('Deckname nicht gefunden', 404)
  return entry
}

type ReleaseReason = 'MANUAL' | 'REASSIGNED' | 'TERMINATED' | 'RETIRED'

export async function closeCodenameAssignment(tx: Prisma.TransactionClient, codenameId: string, actorId: string, reason: ReleaseReason, note?: string) {
  const entry = await findCodename(tx, codenameId)
  const now = new Date()
  const open = await tx.codenameAssignment.findMany({ where: { codenameId, releasedAt: null } })
  if (!entry.currentAgentId && open.length === 0) return entry
  for (const assignment of open) {
    await tx.codenameAssignment.update({ where: { id: assignment.id }, data: {
      releasedAt: now, releasedById: actorId, releaseReason: reason,
      ...(note ? { note: [assignment.note, `Freigabe: ${note}`].filter(Boolean).join('\n') } : {}),
    } })
  }
  await tx.codename.update({ where: { id: codenameId }, data: { currentAgentId: null } })
  if (entry.currentAgentId) await createAuditLog({ action: 'CODENAME_RELEASED', userId: actorId, agentId: entry.currentAgentId, oldValue: entry.name, details: `${reason}${note ? `: ${note}` : ''}` }, tx)
  return entry
}

type AssignInput = { codenameId: string; agentId: string; actorId: string; force?: boolean; note?: string }

/** Must run inside codenameTransaction (also exposed for transaction-level tests). */
export async function assignCodenameInTransaction(tx: Prisma.TransactionClient, { codenameId, agentId, actorId, force = false, note }: AssignInput) {
  // Same row lock as termination's Agent update: a terminated officer cannot
  // obtain a new alias between the status update and the release hook.
  await tx.$queryRaw`SELECT id FROM Agent WHERE id = ${agentId} FOR UPDATE`
  const agent = await tx.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new CodenameError('Agent nicht gefunden', 404)
  if (agent.status === 'TERMINATED') throw new CodenameError('Gekündigten Agents kann kein Deckname zugewiesen werden')
  const entry = await findCodename(tx, codenameId)
  if (entry.retired) throw new CodenameError('Deckname ist gesperrt')
  if (entry.currentAgentId === agentId) return entry
  if (entry.currentAgent && !force) throw new CodenameError(`Deckname ist bereits an ${entry.currentAgent.firstName} ${entry.currentAgent.lastName} (${entry.currentAgent.badgeNumber}) vergeben`)
  if (entry.currentAgentId) await closeCodenameAssignment(tx, codenameId, actorId, 'REASSIGNED')
  const previous = await tx.codename.findUnique({ where: { currentAgentId: agentId } })
  if (previous) await closeCodenameAssignment(tx, previous.id, actorId, 'REASSIGNED')
  await tx.codenameAssignment.create({ data: { codenameId, agentId, assignedById: actorId, note } })
  const updated = await tx.codename.update({ where: { id: codenameId }, data: { currentAgentId: agentId } })
  await createAuditLog({ action: entry.currentAgentId || previous ? 'CODENAME_REASSIGNED' : 'CODENAME_ASSIGNED', userId: actorId, agentId, oldValue: previous?.name, newValue: entry.name, details: JSON.stringify({ previousHolderId: entry.currentAgentId, note }) }, tx)
  return updated
}

export async function assignCodename(input: AssignInput) {
  const result = await codenameTransaction(tx => assignCodenameInTransaction(tx, input))
  queueCodenameBoardUpdate()
  return result
}

export async function releaseCodename({ codenameId, actorId, reason = 'MANUAL', retire = false, note }: { codenameId: string; actorId: string; reason?: ReleaseReason; retire?: boolean; note?: string }) {
  const result = await codenameTransaction(async tx => {
    const entry = await closeCodenameAssignment(tx, codenameId, actorId, retire ? 'RETIRED' : reason, note)
    if (retire && !entry.retired) await createAuditLog({ action: 'CODENAME_RETIRED', userId: actorId, agentId: entry.currentAgentId ?? undefined, newValue: entry.name, details: note }, tx)
    if (!retire) return findCodename(tx, codenameId)
    return tx.codename.update({ where: { id: codenameId }, data: { retired: true, retiredReason: note?.slice(0, 200) ?? entry.retiredReason } })
  })
  queueCodenameBoardUpdate()
  return result
}

/** Caller must queue the board only after its surrounding transaction commits. */
export async function releaseTerminatedCodename(tx: Prisma.TransactionClient, agentId: string, actorId: string) {
  const entry = await tx.codename.findUnique({ where: { currentAgentId: agentId } })
  if (entry) await closeCodenameAssignment(tx, entry.id, actorId, 'TERMINATED')
}

export async function createCodename(input: z.infer<typeof createCodenameSchema>, actorId: string) {
  return codenameTransaction(async tx => {
    const entry = await tx.codename.create({ data: { ...input, createdById: actorId } })
    await createAuditLog({ action: 'CODENAME_CREATED', userId: actorId, newValue: JSON.stringify(entry) }, tx)
    return entry
  })
}

export async function updateCodename(id: string, input: z.infer<typeof updateCodenameSchema>, actorId: string) {
  const result = await codenameTransaction(async tx => {
    const old = await findCodename(tx, id)
    if (input.retired && old.currentAgentId) await closeCodenameAssignment(tx, id, actorId, 'RETIRED')
    const entry = await tx.codename.update({ where: { id }, data: { ...input, ...(input.retired === false ? { retiredReason: null } : {}) } })
    await createAuditLog({ action: input.retired && !old.retired ? 'CODENAME_RETIRED' : 'CODENAME_UPDATED', userId: actorId, agentId: old.currentAgentId ?? undefined, oldValue: JSON.stringify(old), newValue: JSON.stringify(entry) }, tx)
    return entry
  })
  queueCodenameBoardUpdate()
  return result
}

export async function deleteCodename(id: string, actorId: string) {
  return codenameTransaction(async tx => {
    const entry = await findCodename(tx, id)
    if (entry.currentAgentId || await tx.codenameAssignment.count({ where: { codenameId: id } })) throw new CodenameError('Deckname wurde bereits zugewiesen. Bitte stattdessen sperren.')
    await tx.codename.delete({ where: { id } })
    await createAuditLog({ action: 'CODENAME_DELETED', userId: actorId, oldValue: JSON.stringify(entry) }, tx)
    return { id }
  })
}
