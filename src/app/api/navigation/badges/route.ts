import { getCurrentUser } from '@/lib/auth'
import { success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Zähler für die Seitenleiste: „hier wartet Arbeit“. Liefert nur Einträge,
 * für die der Benutzer die Seite auch sehen darf, und nur Werte > 0.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const badges: Record<string, number> = {}

  if (hasPermission(user, 'rank-changes:view')) {
    const openRankChanges = await prisma.rankChangeListEntry.count({
      where: { executed: false, list: { status: 'DRAFT' } },
    })
    if (openRankChanges > 0) badges['/promotions'] = openRankChanges
  }

  return success(badges)
}
