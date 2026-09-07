import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requirePermission('internal-affairs:view')

    const agents = await prisma.agent.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        status: true,
        rank: { select: { id: true, name: true, color: true, sortOrder: true } },
        searches: {
          select: { conductedAt: true },
          orderBy: { conductedAt: 'desc' },
          take: 1,
        },
        _count: { select: { searches: true } },
      },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    })
    const avatarUrls = await resolveAgentAvatarUrls(agents)

    return success(agents.map((agent) => ({
      id: agent.id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      badgeNumber: agent.badgeNumber,
      status: agent.status,
      rank: agent.rank,
      avatarUrl: agentAvatarUrl(agent, avatarUrls),
      searchCount: agent._count.searches,
      lastSearchAt: agent.searches[0]?.conductedAt ?? null,
    })))
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(message, 500)
  }
}
