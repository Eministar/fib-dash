import { prisma } from './prisma'
import {
  recommendedLevel,
  regularLevelForGrade,
  repeatPrinciple,
  resolveViolation,
  sanctionLevelLabel,
  type PenalGrade,
  type SanctionLevel,
} from './sanction-catalog'

/**
 * Wiederholungsfälle nach Abschnitt 04 des Sanktionskatalogs. Gleichartigkeit
 * wird über den Verstoß-Code bestimmt; aufgehobene Sanktionen zählen nicht mit.
 */

export interface PriorSanction {
  id: string
  penalGrade: string
  level: string
  violationCode: string | null
  reason: string
  createdAt: Date
}

export interface RepeatAssessment {
  /** Zählt den aktuellen Verstoß mit: 1 = Erstverstoß. */
  occurrence: number
  /** Grundsatz aus der Wiederholungstabelle. */
  principle: string
  /** Regelsanktion des Grades ohne Wiederholung. */
  regularLevel: SanctionLevel
  /** Empfohlene Stufe unter Berücksichtigung der Wiederholung. */
  recommendedLevel: SanctionLevel
  recommendedLevelLabel: string
  /** Frühere gleichartige Verstöße, neueste zuerst. */
  priors: PriorSanction[]
  /** Jüngster gleichartiger Verstoß — Bezugspunkt der Höherstufung. */
  repeatOfSanctionId: string | null
  violationLabel: string | null
}

/** Sanktionen, die als Vorverstoß zählen. Aufgehobene bleiben ausgenommen. */
const COUNTING_STATUSES = ['ISSUED', 'EXECUTED', 'IN_COURT', 'UPHELD'] as const

export async function assessRepeat(options: {
  agentId: string | null | undefined
  grade: PenalGrade
  violationCode: string | null | undefined
  /** Beim Bearbeiten: eigene Sanktion nicht als Vorverstoß mitzählen. */
  excludeSanctionId?: string | null
}): Promise<RepeatAssessment> {
  const { agentId, grade, violationCode, excludeSanctionId } = options
  const regular = regularLevelForGrade(grade)
  const violation = resolveViolation(violationCode)

  const empty: RepeatAssessment = {
    occurrence: 1,
    principle: repeatPrinciple(1),
    regularLevel: regular,
    recommendedLevel: regular,
    recommendedLevelLabel: sanctionLevelLabel(regular),
    priors: [],
    repeatOfSanctionId: null,
    violationLabel: violation?.label ?? null,
  }

  if (!agentId || !violationCode) return empty

  const priors = await prisma.sanction.findMany({
    where: {
      agentId,
      violationCode,
      status: { in: [...COUNTING_STATUSES] },
      ...(excludeSanctionId ? { id: { not: excludeSanctionId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      penalGrade: true,
      level: true,
      violationCode: true,
      reason: true,
      createdAt: true,
    },
  })

  const occurrence = priors.length + 1
  const suggested = recommendedLevel(grade, occurrence)

  return {
    occurrence,
    principle: repeatPrinciple(occurrence),
    regularLevel: regular,
    recommendedLevel: suggested,
    recommendedLevelLabel: sanctionLevelLabel(suggested),
    priors,
    repeatOfSanctionId: priors[0]?.id ?? null,
    violationLabel: violation?.label ?? null,
  }
}
