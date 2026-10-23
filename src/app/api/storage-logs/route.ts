import { NextRequest } from 'next/server'

import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { rangeStart, storageAlerts, storageLogsConfigured, storageRouteError, storageSummary } from '@/lib/storage-logs/storage-logs-server'

export const dynamic = 'force-dynamic'

/** Übersicht: je Agent die Summen im Zeitraum, dazu die letzten Warnungen. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission('storage-logs:view')
    const since = rangeStart(req.nextUrl.searchParams.get('range'))
    const [rows, alerts, configured] = await Promise.all([storageSummary(since), storageAlerts(since, 20), storageLogsConfigured()])
    return success({ rows, alerts, configured })
  } catch (cause) {
    return storageRouteError(cause)
  }
}
