import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'

/**
 * Agent-Auswahl für das Klage-Modul: alle Agents (auch gekündigte) inkl.
 * Anzahl offener Sanktionen — diejenigen ohne offene Sanktionen werden in der
 * UI nach hinten sortiert.
 */
export async function GET() {
  try {
    await requirePermission('lad:view')

    const [agents, openSanctions] = await Promise.all([
      prisma.agent.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          badgeNumber: true,
          discordId: true,
          status: true,
          rank: { select: { name: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.sanction.findMany({
        where: { status: 'OPEN', agentId: { not: null } },
        select: { agentId: true },
      }),
    ])

    const counts = new Map<string, number>()
    for (const sanction of openSanctions) {
      if (!sanction.agentId) continue
      counts.set(sanction.agentId, (counts.get(sanction.agentId) ?? 0) + 1)
    }

    const rows = agents.map((agent) => ({
      id: agent.id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      badgeNumber: agent.badgeNumber,
      discordId: agent.discordId,
      status: agent.status,
      rankName: agent.rank?.name ?? null,
      openSanctionCount: counts.get(agent.id) ?? 0,
    }))

    rows.sort((a, b) => b.openSanctionCount - a.openSanctionCount
      || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'de'))

    return success(rows)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
