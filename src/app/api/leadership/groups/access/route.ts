import { prisma } from '@/lib/prisma'
import { canManageLeadershipGroups } from '@/lib/units/leadership-groups'
import { groupError, groupResponse, groupUser, viewerAgentIds } from '@/lib/units/leadership-groups-server'

export async function GET() {
  try {
    const user = await groupUser()
    if (canManageLeadershipGroups(user)) return groupResponse({ allowed: true })
    const membership = await prisma.leadershipGroupAgent.findFirst({ where: { agentId: { in: await viewerAgentIds(user) } }, select: { groupId: true } })
    return groupResponse({ allowed: !!membership })
  } catch (error) { return groupError(error) }
}
