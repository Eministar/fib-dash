import { getCurrentUser } from '@/lib/auth'
import { success , forbidden } from '@/lib/api-response'

export async function GET() {
  const user = await getCurrentUser()
  return success(user)
}
