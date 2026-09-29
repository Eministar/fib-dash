import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { INACTIVITY_NOTE_DISMISSED_ACTION, SYSTEM_NOTE_TITLE, runAgentStatusAutomation } from '@/lib/absence-status'

/** Hebt den Inaktiv-Status eines einzelnen Agents auf; die Fehlzeit zählt ab jetzt neu. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['agents:write'])
    const { id } = await params
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!agent) return notFound('Agent')
    if (agent.status === 'TERMINATED') return error('Gekündigte Agents haben keine Fehlzeit.')

    await prisma.$transaction([
      prisma.note.deleteMany({ where: { agentId: id, title: SYSTEM_NOTE_TITLE } }),
      prisma.auditLog.create({
        data: {
          action: INACTIVITY_NOTE_DISMISSED_ACTION,
          userId: user.id,
          agentId: id,
          details: 'Fehlzeit zurückgesetzt – Zählung beginnt neu',
        },
      }),
    ])
    await runAgentStatusAutomation({ force: true })
    return success({ message: 'Fehlzeit zurückgesetzt' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
