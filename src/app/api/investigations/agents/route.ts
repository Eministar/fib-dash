import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { routeError } from '@/lib/investigations/investigations-server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Auswahlliste für Fallführung und Zuweisungen: nur Name, Dienstnummer und
 * Rang. Externe Ermittler haben kein `agents:view` und sollen über die Akten
 * keine Personalakten zu sehen bekommen.
 */
export async function GET() {
  try {
    await requirePermission('investigations:manage')
    const agents = await prisma.agent.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        rank: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    })
    return success(agents)
  } catch (cause) {
    return routeError(cause)
  }
}
