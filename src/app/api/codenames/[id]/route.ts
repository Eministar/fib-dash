import { requirePermission } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { updateCodename, deleteCodename } from '@/lib/codenames'
import { updateCodenameSchema } from '@/lib/codename-validation'
import { codenameRouteError } from '@/lib/codename-route-error'

type Context = { params: Promise<{ id: string }> }
export async function PATCH(req: Request, context: Context) {
  try {
    const user = await requirePermission('codenames:manage')
    return success(await updateCodename((await context.params).id, updateCodenameSchema.parse(await req.json()), user.id))
  } catch (cause) { return codenameRouteError(cause) }
}
export async function DELETE(_req: Request, context: Context) {
  try {
    const user = await requirePermission('codenames:manage')
    return success(await deleteCodename((await context.params).id, user.id))
  } catch (cause) { return codenameRouteError(cause) }
}
