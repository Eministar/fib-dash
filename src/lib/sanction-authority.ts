import { prisma } from './prisma'
import {
  SANCTION_AUTHORITIES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  authorityForSanction,
  type PenalGrade,
  type SanctionLevel,
} from './sanction-catalog'

/**
 * Zuständigkeiten aus Abschnitt 05 des Sanktionskatalogs. Die Zuordnung
 * Stufe → Mindestrang liegt in der Datenbank, damit sie ohne Code-Change
 * angepasst werden kann; fehlt ein Eintrag, greift der Katalog-Standard.
 */

export interface AuthorityCheckResult {
  allowed: boolean
  /** Grund der Ablehnung, direkt für die Fehlermeldung verwendbar. */
  reason?: string
  authorityLabel: string
  minRankSortOrder: number
  actorRankName: string | null
}

export async function getLevelAuthorities() {
  const rows = await prisma.sanctionLevelAuthority.findMany()
  const byLevel = new Map(rows.map((row) => [row.level, row]))

  return SANCTION_LEVEL_ORDER.map((level) => {
    const stored = byLevel.get(level)
    const fallback = SANCTION_AUTHORITIES[SANCTION_LEVELS[level].authority]
    return {
      level,
      authorityLabel: stored?.authorityLabel ?? fallback.label,
      minRankSortOrder: stored?.minRankSortOrder ?? fallback.defaultMinRankSortOrder,
    }
  })
}

/** Legt die Standard-Zuständigkeiten an, ohne bestehende Anpassungen zu überschreiben. */
export async function seedLevelAuthorities() {
  for (const level of SANCTION_LEVEL_ORDER) {
    const fallback = SANCTION_AUTHORITIES[SANCTION_LEVELS[level].authority]
    await prisma.sanctionLevelAuthority.upsert({
      where: { level },
      update: {},
      create: {
        level,
        authorityLabel: fallback.label,
        minRankSortOrder: fallback.defaultMinRankSortOrder,
      },
    })
  }
}

/** Rang der handelnden Person — über die Agent-Personalakte des Accounts. */
export async function getActorRank(userId: string | null | undefined) {
  if (!userId) return null
  const agent = await prisma.agent.findFirst({
    where: { userId },
    select: { id: true, rank: { select: { name: true, sortOrder: true } } },
  })
  return agent ? { agentId: agent.id, ...agent.rank } : null
}

/**
 * Prüft, ob `userId` die Sanktion aussprechen darf. `override` überspringt die
 * Rangprüfung (Permission `sanctions:override-authority`) — gedacht für
 * HR- und Admin-Accounts ohne eigene Personalakte.
 */
export async function checkSanctionAuthority(options: {
  userId: string | null | undefined
  grade: PenalGrade
  level: SanctionLevel
  targetAgentId?: string | null
  override?: boolean
}): Promise<AuthorityCheckResult> {
  const { userId, grade, level, targetAgentId, override } = options

  const authorities = await getLevelAuthorities()
  const configured = authorities.find((item) => item.level === level)
  const catalogAuthority = authorityForSanction(grade, level)
  const minRankSortOrder = configured?.minRankSortOrder ?? catalogAuthority.defaultMinRankSortOrder
  const authorityLabel = configured?.authorityLabel ?? catalogAuthority.label

  const actor = await getActorRank(userId)

  // Niemand entscheidet über ein Verfahren gegen die eigene Person.
  if (actor && targetAgentId && actor.agentId === targetAgentId) {
    return {
      allowed: false,
      reason: 'Niemand entscheidet über ein Verfahren gegen die eigene Person.',
      authorityLabel,
      minRankSortOrder,
      actorRankName: actor.name,
    }
  }

  if (override) {
    return { allowed: true, authorityLabel, minRankSortOrder, actorRankName: actor?.name ?? null }
  }

  if (!actor) {
    return {
      allowed: false,
      reason:
        'Diesem Account ist keine Personalakte zugeordnet, der Rang lässt sich nicht prüfen. ' +
        'Verknüpfung nachtragen oder Berechtigung "Zuständigkeit übergehen" vergeben.',
      authorityLabel,
      minRankSortOrder,
      actorRankName: null,
    }
  }

  // Kleiner sortOrder = höherer Rang.
  if (actor.sortOrder > minRankSortOrder) {
    const minRank = await prisma.rank.findFirst({
      where: { sortOrder: minRankSortOrder },
      select: { name: true },
    })
    return {
      allowed: false,
      reason:
        `Stufe ${level} (${SANCTION_LEVELS[level].measure}) spricht die ${authorityLabel} aus. ` +
        `Erforderlich ist mindestens ${minRank?.name ?? `Rangstufe ${minRankSortOrder}`}, ` +
        `dein Rang ist ${actor.name}.`,
      authorityLabel,
      minRankSortOrder,
      actorRankName: actor.name,
    }
  }

  return { allowed: true, authorityLabel, minRankSortOrder, actorRankName: actor.name }
}
