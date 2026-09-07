import { getCurrentUser } from '@/lib/auth'
import { notFound, success, unauthorized } from '@/lib/api-response'
import { getNavigationUnitForUser } from '@/lib/unit-navigation'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  const { key } = await params
  const unit = await getNavigationUnitForUser(user, decodeURIComponent(key))
  if (!unit) return notFound('Unit')
  return success(unit)
}
