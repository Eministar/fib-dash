import { success } from '@/lib/api-response'
import { bodycamAccess } from '@/lib/bodycam-access'
import { routeError } from '@/lib/investigations-server'

export async function GET() {
  try { const access = await bodycamAccess(); return success({ allowed: true, full: access.full }) }
  catch (cause) { return routeError(cause) }
}
