import { prisma } from '@/lib/prisma'
import { canManageLeadershipGroups, leadershipGroupSchema } from '@/lib/leadership-groups'
import { groupError, groupResponse, groupUser, listGroups, saveGroup } from '@/lib/leadership-groups-server'

export const maxDuration = 120

export async function GET() {
  try {
    const user = await groupUser()
    const groups = await listGroups(user)
    const manage = canManageLeadershipGroups(user)
    const members = manage
      ? await prisma.user.findMany({ where: { discordId: { not: null } }, select: { id: true, displayName: true }, orderBy: { displayName: 'asc' } })
      : []
    return groupResponse({ manage, groups, members })
  } catch (error) { return groupError(error) }
}

export async function POST(req: Request) {
  try {
    const user = await groupUser(true)
    return groupResponse(await saveGroup(undefined, leadershipGroupSchema.parse(await req.json()), user), 201)
  } catch (error) { return groupError(error) }
}
