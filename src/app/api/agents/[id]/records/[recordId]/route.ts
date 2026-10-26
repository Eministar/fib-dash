import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { listAgentRecords } from '@/lib/agents/agent-records'
import { deleteClipFile } from '@/lib/media/clips'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const user = await requirePermission('agents:write')
    const { id, recordId } = await params
    const entry = await prisma.agentRecordEntry.findFirst({
      where: { id: recordId, agentId: id },
      include: { clips: { select: { filename: true, compressionSource: true, compressionOutput: true } } },
    })
    if (!entry) return notFound('Eintrag')

    const label = entry.kind === 'POSITIVE' ? 'Positiver' : 'Negativer'
    await prisma.$transaction([
      // Angehängte Clips verschwinden per Cascade mit dem Eintrag.
      prisma.agentRecordEntry.delete({ where: { id: entry.id } }),
      prisma.auditLog.create({
        data: { action: 'AGENT_RECORD_DELETED', userId: user.id, agentId: id, details: `${label} Eintrag gelöscht: ${entry.title}` },
      }),
    ])
    // Die Videodateien liegen außerhalb der Datenbank und werden danach weggeräumt.
    await Promise.all(entry.clips
      .flatMap((clip) => [clip.filename, clip.compressionSource, clip.compressionOutput])
      .filter((filename): filename is string => Boolean(filename))
      .map(deleteClipFile))
    return success(await listAgentRecords(id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
