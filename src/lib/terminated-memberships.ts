import type { Prisma } from '@/generated/prisma'

/** Remove access inside the same transaction that terminates the personnel record. */
export async function detachTerminatedAgent(tx: Prisma.TransactionClient, agentId: string) {
  const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true, userId: true, discordId: true, status: true } })
  if (!agent || agent.status !== 'TERMINATED') return
  const accounts = await tx.user.findMany({
    where: { OR: [
      { agentProfile: { is: { id: agentId } } },
      ...(agent.discordId ? [{ discordId: agent.discordId }] : []),
    ] }, select: { id: true },
  })
  const ids = accounts.map(account => account.id)
  if (!ids.length) return
  const groups = await tx.leadershipGroup.findMany({ where: { members: { some: { userId: { in: ids } } } } })
  for (const group of groups) {
    const families = removeFamilyLeads(group.families, ids)
    await tx.leadershipGroup.update({ where: { id: group.id }, data: {
      families, version: { increment: 1 }, syncPending: true, nextSyncAt: new Date(),
    } })
    await tx.leadershipGroupMember.deleteMany({ where: { groupId: group.id, userId: { in: ids } } })
    await tx.leadershipGroupEvent.create({ data: {
      groupId: group.id, kind: 'removed', text: 'Die Mitgliedschaft eines gekündigten Agents wurde beendet. Freie Leitungen müssen neu besetzt werden.',
    } })
  }
}

export function removeFamilyLeads(value: Prisma.JsonValue, removedIds: string[]) {
  if (!Array.isArray(value)) return []
  const removed = new Set(removedIds)
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string') return []
    const leadIds = Array.isArray(entry.leadIds) ? entry.leadIds.filter((id): id is string => typeof id === 'string' && !removed.has(id)) : []
    return [{ name: entry.name, leadIds }]
  })
}

/** Match both explicit account links and legacy Discord-only links. */
export async function terminatedGroupUserIds(tx: Prisma.TransactionClient): Promise<string[]> {
  const agents = await tx.agent.findMany({ where: { status: 'TERMINATED' }, select: { userId: true, discordId: true } })
  const users = await tx.user.findMany({ where: { OR: [
    { id: { in: agents.flatMap(agent => agent.userId ? [agent.userId] : []) } },
    { discordId: { in: agents.flatMap(agent => agent.discordId ? [agent.discordId] : []) } },
  ] }, select: { id: true } })
  return users.map(user => user.id)
}
