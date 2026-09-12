import { prisma } from '@/lib/prisma'
import { canManageLeadershipGroups } from '@/lib/leadership-groups'
import { groupError, groupResponse, groupUser } from '@/lib/leadership-groups-server'

export async function GET() {
  try {
    const user = await groupUser()
    return groupResponse({ allowed: canManageLeadershipGroups(user) || !!await prisma.leadershipGroupMember.findFirst({ where: { userId: user.id }, select: { groupId: true } }) })
  } catch (error) { return groupError(error) }
}
