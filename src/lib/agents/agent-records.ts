import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export const agentRecordInput = z.object({
  kind: z.enum(['POSITIVE', 'NEGATIVE']),
  title: z.string().trim().min(2, 'Titel ist zu kurz').max(200),
  content: z.string().trim().max(5000).optional().transform((value) => value || null),
})

export async function listAgentRecords(agentId: string) {
  const entries = await prisma.agentRecordEntry.findMany({
    where: { agentId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { displayName: true } } },
  })
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      source: entry.source,
      createdAt: entry.createdAt,
      author: entry.source === 'manual' ? entry.author?.displayName ?? null : 'System',
    })),
    positive: entries.filter((entry) => entry.kind === 'POSITIVE').length,
    negative: entries.filter((entry) => entry.kind === 'NEGATIVE').length,
  }
}
