import type { NextRequest } from 'next/server'

import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { computeAchievements } from '@/lib/achievements'
import { getAgentOfMonthWins } from '@/lib/agent-of-month-server'
import { getAgentAllTimePlaytimeMs } from '@/lib/duty-times'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('agents:view')
    const { id } = await params
    const now = new Date()
    const agent = await prisma.agent.findUnique({ where: { id }, select: { hireDate: true } })
    if (!agent) return notFound('Agent')

    const [totalDutyMs, completedTrainings, closedCasesLed, agentOfMonthWins] = await Promise.all([
      getAgentAllTimePlaytimeMs(id, now),
      prisma.agentTraining.count({ where: { agentId: id, completed: true } }),
      prisma.investigation.count({ where: { leadAgentId: id, status: { in: ['CLOSED', 'ARCHIVED'] } } }),
      getAgentOfMonthWins(id, now),
    ])

    return success(computeAchievements({ hireDate: agent.hireDate, totalDutyMs, completedTrainings, closedCasesLed, agentOfMonthWins, now }))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
