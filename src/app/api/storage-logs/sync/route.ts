import { success } from '@/lib/api-response'
import { requirePermission } from '@/lib/auth'
import { relinkUnassignedStorageEntries, syncStorageLogChannel, storageRouteError } from '@/lib/storage-logs/storage-logs-server'

export const dynamic = 'force-dynamic'

/** Sofort nachholen und nicht zugeordnete Namen erneut mit den Agents abgleichen. */
export async function POST() {
  try {
    await requirePermission('settings:manage')
    const synced = await syncStorageLogChannel()
    const linked = await relinkUnassignedStorageEntries()
    return success({ ...synced, linked })
  } catch (cause) {
    return storageRouteError(cause)
  }
}
