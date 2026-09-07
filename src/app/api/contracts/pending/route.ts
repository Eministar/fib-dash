import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { summarizeAgentContracts } from '@/lib/contract-service'

/**
 * Alle aktiven Mitarbeiter ohne unterschriebenen Arbeitsvertrag.
 *
 * Bestandsmitarbeiter wurden vor Einführung der Vertragspflicht eingestellt und
 * haben deshalb noch keinen Vertrag. Diese Liste ist die Arbeitsgrundlage, um
 * die Unterschriften nachzuholen.
 */
export async function GET() {
  try {
    await requirePermission(['contracts:view', 'contracts:manage'])

    const agents = await prisma.agent.findMany({
      where: {
        status: { not: 'TERMINATED' },
        // Agent, die bereits einen unterschriebenen Vertrag haben, sind fertig.
        contracts: { none: { status: 'SIGNED' } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        status: true,
        hireDate: true,
        rank: { select: { id: true, name: true, sortOrder: true } },
        contracts: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            signedAt: true,
            sentAt: true,
            createdAt: true,
            sendCount: true,
            lastSendError: true,
          },
        },
      },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    })

    return success(
      agents.map((agent) => ({
        ...agent,
        contract: summarizeAgentContracts(agent.contracts),
        latestContract: agent.contracts[0] ?? null,
      })),
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
