import { getCurrentUser } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { listNavigationUnitsForUser } from '@/lib/unit-navigation'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  return success(await listNavigationUnitsForUser(user))
}
