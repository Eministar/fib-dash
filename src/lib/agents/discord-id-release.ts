import { prisma } from '../prisma'

/**
 * Discord-ID eines aktiven Agents (ohne `currentAgentId`), falls vorhanden.
 * Gekündigte Agents zählen nicht: ihre Discord-ID wird bei einer Neueinstellung freigegeben.
 */
export async function findActiveDiscordIdOwner(discordId: string, currentAgentId?: string | null) {
  return prisma.agent.findFirst({
    where: {
      discordId,
      status: { not: 'TERMINATED' },
      ...(currentAgentId ? { NOT: { id: currentAgentId } } : {}),
    },
    select: { id: true },
  })
}

/**
 * `Agent.discordId` ist eindeutig. Hält noch ein gekündigter Datensatz die ID,
 * wird sie dort entfernt, damit die Person neu eingestellt oder einem anderen
 * Agent zugeordnet werden kann.
 */
export async function releaseTerminatedDiscordId(discordId: string, currentAgentId?: string | null) {
  await prisma.agent.updateMany({
    where: {
      discordId,
      status: 'TERMINATED',
      ...(currentAgentId ? { NOT: { id: currentAgentId } } : {}),
    },
    data: { discordId: null },
  })
}
