import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { rangeStart, storageEntries, storageRouteError } from '@/lib/storage-logs/storage-logs-server'

export const dynamic = 'force-dynamic'

/** Alle Lagervorgänge eines Agents oder eines nicht zugeordneten Namens. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission('storage-logs:view')
    const params = req.nextUrl.searchParams
    const direction = params.get('direction')
    const entries = await storageEntries({
      agentId: params.get('agentId')?.slice(0, 191) || null,
      actorName: params.get('actor')?.slice(0, 120) || null,
      since: rangeStart(params.get('range')),
      direction: direction === 'IN' || direction === 'OUT' ? direction : null,
    })
    return success(entries)
  } catch (cause) {
    return storageRouteError(cause)
  }
}
