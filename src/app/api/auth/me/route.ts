import { getCurrentUser } from '@/lib/auth'
import { success } from '@/lib/api-response'

export async function GET() {
  const user = await getCurrentUser()
  return success(user)
}
