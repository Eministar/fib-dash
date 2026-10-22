import { notFound, success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { storageEntryWithContext, storageRouteError } from '@/lib/storage-logs-server'

export const dynamic = 'force-dynamic'

/** Ein Lagervorgang über seinen Slug, mit dem Umfeld derselben Person. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await requirePermission('storage-logs:view')
    const slug = (await params).slug.toUpperCase()
    if (!/^LAG-[A-Z0-9]{6}$/.test(slug)) return notFound('Lagereintrag')
    const result = await storageEntryWithContext(slug)
    return result ? success(result) : notFound('Lagereintrag')
  } catch (cause) {
    return storageRouteError(cause)
  }
}
