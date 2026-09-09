import { requireAuth, requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { getActorRank, getLevelAuthorities } from '@/lib/sanction-authority'
import {
  AGGRAVATING_CIRCUMSTANCES,
  CATALOG_PRINCIPLE,
  CATALOG_VERSION,
  DECISION_CHECKLIST,
  MITIGATING_CIRCUMSTANCES,
  PENAL_GRADE_ORDER,
  PENAL_GRADE_RULES,
  PROCEDURE_STEPS,
  REPEAT_RULES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  SANCTION_VIOLATIONS,
} from '@/lib/sanctions'

/**
 * Der vollständige Sanktionskatalog inklusive der in der Datenbank
 * hinterlegten Zuständigkeiten. Jeder eingeloggte Agent darf ihn einsehen —
 * der Katalog ist interner Dienststandard, kein Verschlusssache-Dokument.
 */
export async function GET() {
  let userId: string | null = null
  try {
    const user = await requireAuth()
    userId = user.id
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    return error(msg, 500)
  }

  const [authorities, ranks, actorRank] = await Promise.all([
    getLevelAuthorities(),
    prisma.rank.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { name: true, sortOrder: true, color: true },
    }),
    getActorRank(userId),
  ])

  const rankBySortOrder = new Map(ranks.map((rank) => [rank.sortOrder, rank]))

  return success({
    version: CATALOG_VERSION,
    principle: CATALOG_PRINCIPLE,
    grades: PENAL_GRADE_ORDER.map((grade) => ({
      ...PENAL_GRADE_RULES[grade],
      violations: SANCTION_VIOLATIONS.filter((item) => item.grade === grade),
    })),
    levels: SANCTION_LEVEL_ORDER.map((level) => {
      const authority = authorities.find((item) => item.level === level)
      return {
        ...SANCTION_LEVELS[level],
        authorityLabel: authority?.authorityLabel ?? null,
        minRankSortOrder: authority?.minRankSortOrder ?? null,
        minRankName: authority ? rankBySortOrder.get(authority.minRankSortOrder)?.name ?? null : null,
        /** Darf der aufrufende Account diese Stufe aussprechen? */
        allowedForActor: actorRank && authority ? actorRank.sortOrder <= authority.minRankSortOrder : null,
      }
    }),
    repeatRules: REPEAT_RULES,
    mitigating: MITIGATING_CIRCUMSTANCES,
    aggravating: AGGRAVATING_CIRCUMSTANCES,
    procedure: PROCEDURE_STEPS,
    checklist: DECISION_CHECKLIST,
    actorRank: actorRank ? { name: actorRank.name, sortOrder: actorRank.sortOrder } : null,
  })
}

/** Mindestränge je Sanktionsstufe anpassen (Abschnitt 05). */
export async function PATCH(req: Request) {
  try {
    await requirePermission('settings:manage')
    const body = await req.json()
    const entries = Array.isArray(body.levels) ? body.levels : []

    for (const entry of entries) {
      const level = typeof entry?.level === 'string' ? entry.level : ''
      if (!SANCTION_LEVEL_ORDER.includes(level as (typeof SANCTION_LEVEL_ORDER)[number])) continue
      const minRankSortOrder = Number.parseInt(String(entry?.minRankSortOrder), 10)
      if (!Number.isSafeInteger(minRankSortOrder)) continue
      const authorityLabel = typeof entry?.authorityLabel === 'string' && entry.authorityLabel.trim()
        ? entry.authorityLabel.trim()
        : null

      await prisma.sanctionLevelAuthority.upsert({
        where: { level },
        update: { minRankSortOrder, ...(authorityLabel ? { authorityLabel } : {}) },
        create: {
          level,
          minRankSortOrder,
          authorityLabel: authorityLabel ?? SANCTION_LEVELS[level as (typeof SANCTION_LEVEL_ORDER)[number]].measure,
        },
      })
    }

    return success(await getLevelAuthorities())
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
