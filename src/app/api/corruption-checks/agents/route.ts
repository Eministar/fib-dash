import { requireAuth } from '@/lib/auth'
import { success } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { corruptionError } from '@/lib/corruption-server'

// Only identification fields; no access to agents' HR records is granted.
export async function GET() {
  try {
    await requireAuth()
    return success(await prisma.agent.findMany({ select: { id: true, firstName: true, lastName: true, badgeNumber: true, status: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }))
  } catch (cause) { return corruptionError(cause) }
}
