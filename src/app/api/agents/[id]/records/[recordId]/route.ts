import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { listAgentRecords } from '@/lib/agent-records'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const user = await requirePermission('agents:write')
    const { id, recordId } = await params
    const entry = await prisma.agentRecordEntry.findFirst({ where: { id: recordId, agentId: id } })
    if (!entry) return notFound('Eintrag')

    const label = entry.kind === 'POSITIVE' ? 'Positiver' : 'Negativer'
    await prisma.$transaction([
      prisma.agentRecordEntry.delete({ where: { id: entry.id } }),
      prisma.auditLog.create({
        data: { action: 'AGENT_RECORD_DELETED', userId: user.id, agentId: id, details: `${label} Eintrag gelöscht: ${entry.title}` },
      }),
    ])
    return success(await listAgentRecords(id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
