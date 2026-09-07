import { prisma } from '@/lib/prisma'
import { success } from '@/lib/api-response'
import { agentUnitKeys } from '@/lib/agent-units'

export async function GET() {
  const [agents, units] = await Promise.all([
    prisma.agent.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: {
        badgeNumber: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        unit: true,
        units: true,
        rank: { select: { name: true, color: true, sortOrder: true } },
      },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    }),
    prisma.unit.findMany({ select: { key: true, name: true, color: true } }),
  ])

  const unitMap = new Map(units.map((unit) => [unit.key, unit]))

  return success(agents.map((agent) => ({
    ...agent,
    unitInfo: agentUnitKeys(agent).map((unitKey) => unitMap.get(unitKey)).filter((unit) => unit != null),
  })))
}
