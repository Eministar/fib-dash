import { leadershipGroupSchema } from '@/lib/leadership-groups'
import { groupError, groupResponse, groupUser, saveGroup } from '@/lib/leadership-groups-server'

export const maxDuration = 120

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await groupUser(true)
    const { id } = await context.params
    return groupResponse(await saveGroup(id, leadershipGroupSchema.parse(await req.json()), user))
  } catch (error) { return groupError(error) }
}
