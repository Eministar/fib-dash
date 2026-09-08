import { z } from 'zod'
import { Prisma } from '@/generated/prisma'
import { corruptionCheckSchema } from './corruption-validation'
import { CorruptionError, corruptionInclude, resolveOfficial } from './corruption-server'
import { createAuditLog } from './audit'

export const correctionSchema = z.object({
  version: z.number().int().positive(), reason: z.string().trim().min(3).max(1000),
  conductedAt: corruptionCheckSchema.shape.conductedAt,
  agentIds: z.array(z.string().trim().min(1).max(191)).max(30).transform(ids => [...new Set(ids)]),
  result: corruptionCheckSchema.shape.result,
  findings: corruptionCheckSchema.shape.findings,
  location: corruptionCheckSchema.shape.location,
  notes: corruptionCheckSchema.shape.notes,
}).strict().refine(value => value.result !== 'FINDINGS' || !!value.findings, 'Bitte den Befund beschreiben')

export function reportSnapshot(check: { conductedAt: Date; result: string; findings: string; location: string | null; notes: string | null; agents: { name: string; badgeNumber: string; agentId?: string | null }[] }) {
  return { conductedAt: check.conductedAt.toISOString(), result: check.result, findings: check.findings, location: check.location, notes: check.notes, agents: check.agents.map(a => ({ agentId: a.agentId ?? null, name: a.name, badgeNumber: a.badgeNumber })) }
}

export async function correctReport(tx: Prisma.TransactionClient, id: string, input: z.infer<typeof correctionSchema>, user: { id: string; displayName: string }) {
  const before = await tx.corruptionCheck.findUnique({ where: { id }, include: corruptionInclude })
  if (!before) throw new CorruptionError('Bericht nicht gefunden', 404)
  if (before.version !== input.version) throw new CorruptionError('Dieser Bericht wurde bereits geändert. Bitte neu öffnen.', 409)
  const agents = await tx.agent.findMany({ where: { id: { in: input.agentIds } }, select: { id: true, firstName: true, lastName: true, badgeNumber: true } })
  if (agents.length !== input.agentIds.length) throw new CorruptionError('Agent nicht mehr verfügbar. Bitte Auswahl prüfen.')
  const snapshots = [
    ...agents.map(a => {
      const original = before.agents.find(old => old.agentId === a.id)
      return { checkId: id, agentId: a.id, name: original?.name ?? `${a.firstName} ${a.lastName}`, badgeNumber: original?.badgeNumber ?? a.badgeNumber }
    }),
    ...before.agents.filter(a => !a.agentId).map(a => ({ checkId: id, agentId: null, name: a.name, badgeNumber: a.badgeNumber })),
  ]
  if (!snapshots.length) throw new CorruptionError('Mindestens einen durchführenden Agent auswählen')
  const changed = await tx.corruptionCheck.updateMany({ where: { id, version: input.version }, data: {
    version: { increment: 1 }, conductedAt: new Date(input.conductedAt), result: input.result,
    findings: input.findings || 'Ohne Befund', location: input.location || null, notes: input.notes || null,
  } })
  if (changed.count !== 1) throw new CorruptionError('Dieser Bericht wurde gleichzeitig geändert. Bitte neu öffnen.', 409)
  await tx.corruptionCheckAgent.deleteMany({ where: { checkId: id } })
  await tx.corruptionCheckAgent.createMany({ data: snapshots })
  const after = await tx.corruptionCheck.findUniqueOrThrow({ where: { id }, include: corruptionInclude })
  await tx.corruptionRevision.create({ data: { checkId: id, version: after.version, before: reportSnapshot(before), after: reportSnapshot(after), reason: input.reason, actorId: user.id, actorName: user.displayName } })
  await createAuditLog({ action: 'CORRUPTION_CHECK_CORRECTED', userId: user.id, details: `${id}: ${input.reason}` }, tx)
  return after
}

export async function mergeOfficials(tx: Prisma.TransactionClient, sourceId: number, targetId: number, reason: string, user: { id: string; displayName: string }) {
  const source = await tx.publicOfficial.findUnique({ where: { id: sourceId } })
  const target = await resolveOfficial(tx, targetId)
  if (!source || !target) throw new CorruptionError('Beamtenakte nicht gefunden', 404)
  if (source.mergedIntoId) throw new CorruptionError('Die Ausgangsakte wurde bereits zusammengeführt. Bitte neu laden.', 409)
  if (source.id === target.id) throw new CorruptionError('Bitte zwei unterschiedliche Akten wählen.')
  await tx.publicOfficial.update({ where: { id: source.id }, data: { mergedIntoId: target.id } })
  await tx.publicOfficial.updateMany({ where: { mergedIntoId: source.id }, data: { mergedIntoId: target.id } })
  const moved = await tx.corruptionCheck.updateMany({ where: { officialId: source.id }, data: { officialId: target.id } })
  await createAuditLog({ action: 'CORRUPTION_OFFICIALS_MERGED', userId: user.id, oldValue: JSON.stringify(source), newValue: JSON.stringify(target), details: `${user.displayName}: ${moved.count} Kontrollen verschoben. ${reason}` }, tx)
  return { target, moved: moved.count }
}
