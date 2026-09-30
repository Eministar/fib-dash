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

  const [openRankChanges, awaitingConfirmation, openAgreements] = await Promise.all([
    hasPermission(user, 'rank-changes:view')
      ? prisma.rankChangeListEntry.count({ where: { executed: false, list: { status: 'DRAFT' } } })
      : 0,
    // Vier-Augen-Prinzip: PG 5/6 braucht die Bestätigung einer ZWEITEN Führungskraft –
    // eigene Sanktionen zählen deshalb nicht mit.
    hasPermission(user, 'sanctions:confirm')
      ? prisma.sanction.count({
          where: {
            penalGrade: { in: ['5', '6'] },
            confirmedAt: null,
            status: 'ISSUED',
            // `NOT: { issuedByUserId }` würde in SQL auch Zeilen ohne Aussteller (NULL) verwerfen.
            OR: [{ issuedByUserId: null }, { issuedByUserId: { not: user.id } }],
          },
        })
      : 0,
    hasPermission(user, 'agreements:manage')
      ? prisma.agreement.count({ where: { status: 'OPEN' } })
      : 0,
  ])

  if (openRankChanges > 0) badges['/promotions'] = openRankChanges
  if (awaitingConfirmation > 0) badges['/sanktionen'] = awaitingConfirmation
  if (openAgreements > 0) badges['/vertraege'] = openAgreements

  return success(badges)
}
