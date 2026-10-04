import type { Prisma } from '@/generated/prisma'
import { remapFamilyLeads } from './leadership-groups'

/** Remove access inside the same transaction that terminates the personnel record. */
export async function detachTerminatedAgent(tx: Prisma.TransactionClient, agentId: string) {
  const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { status: true } })
  if (!agent || agent.status !== 'TERMINATED') return
  const groups = await tx.leadershipGroup.findMany({ where: { agents: { some: { agentId } } } })
  for (const group of groups) {
    const families = remapFamilyLeads(group.families, id => id === agentId ? null : id)
    await tx.leadershipGroup.update({ where: { id: group.id }, data: {
      families, version: { increment: 1 }, syncPending: true, nextSyncAt: new Date(),
    } })
    await tx.leadershipGroupAgent.deleteMany({ where: { groupId: group.id, agentId } })
    await tx.leadershipGroupEvent.create({ data: {
      groupId: group.id, kind: 'removed', text: 'Die Mitgliedschaft eines gekündigten Agents wurde beendet. Freie Leitungen müssen neu besetzt werden.',
    } })
  }
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
