import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { releaseCodename } from '@/lib/codenames/codenames'
import { releaseCodenameSchema } from '@/lib/codenames/codename-validation'
import { codenameRouteError } from '@/lib/codenames/codename-route-error'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('codenames:manage')
    const input = releaseCodenameSchema.parse(await req.json())
    return success(await releaseCodename({ ...input, codenameId: (await params).id, actorId: user.id }))
  } catch (cause) { return codenameRouteError(cause) }
}
