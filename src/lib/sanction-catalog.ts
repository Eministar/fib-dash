export type PenalGrade = 'I' | 'II' | 'III' | 'IV' | 'V'
export type SanctionMeasureType = 'FINE' | 'SG_ROUNDS'

export const SANCTION_MEASURE_TYPES: ReadonlySet<string> = new Set(['FINE', 'SG_ROUNDS'])

export interface SanctionPenaltyRule {
  grade: PenalGrade
  fineAmount: number
  sgRounds: number
  penalty: string
}

export const SANCTION_CATALOG: Record<PenalGrade, SanctionPenaltyRule> = {
  I: {
    grade: 'I',
    fineAmount: 10_000,
    sgRounds: 1,
    penalty: 'Keine weiteren Maßnahmen',
  },
  II: {
    grade: 'II',
    fineAmount: 20_000,
    sgRounds: 2,
    penalty: 'Suspendierung bis maximal 48 Stunden möglich',
  },
  III: {
    grade: 'III',
    fineAmount: 40_000,
    sgRounds: 3,
    penalty: 'Unbefristete Suspendierung möglich',
  },
  IV: {
    grade: 'IV',
    fineAmount: 60_000,
    sgRounds: 4,
    penalty: 'Unbefristete Suspendierung; gegebenenfalls Entlassung',
  },
  V: {
    grade: 'V',
    fineAmount: 85_000,
    sgRounds: 5,
    penalty: 'Entlassung',
  },
}

export const PENAL_GRADES: ReadonlySet<string> = new Set(Object.keys(SANCTION_CATALOG))

export function isPenalGrade(value: string): value is PenalGrade {
  return PENAL_GRADES.has(value)
}

export function isSanctionMeasureType(value: unknown): value is SanctionMeasureType {
  return typeof value === 'string' && SANCTION_MEASURE_TYPES.has(value)
}

/** Legacy-Sanktionen waren immer Geldstrafen und werden deshalb so interpretiert. */
export function normalizeSanctionMeasureType(value: unknown): SanctionMeasureType {
  return value === 'SG_ROUNDS' ? 'SG_ROUNDS' : 'FINE'
}

export function resolveSanctionPenalty(value: string) {
  return isPenalGrade(value) ? SANCTION_CATALOG[value] : null
}

export function resolveSanctionMeasure(rule: SanctionPenaltyRule, measureType: SanctionMeasureType) {
  if (measureType === 'SG_ROUNDS') {
    return {
      measureType,
      fineAmount: null,
      sgRounds: rule.sgRounds,
      label: `SG-Runden: ${rule.sgRounds}`,
    }
  }
  return {
    measureType: 'FINE' as const,
    fineAmount: rule.fineAmount,
    sgRounds: null,
    label: `Geldstrafe: ${formatFineAmount(rule.fineAmount)}`,
  }
}

export function sanctionMeasureLabel(value: {
  measureType?: string | null
  fineAmount?: number | null
  sgRounds?: number | null
}) {
  if (normalizeSanctionMeasureType(value.measureType) === 'SG_ROUNDS') {
    return `SG-Runden: ${value.sgRounds ?? '—'}`
  }
  return `Geldstrafe: ${formatFineAmount(value.fineAmount ?? null)}`
}

export function formatFineAmount(value: number | null) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('de-DE').format(value)} $`
}

export function penalGradeLabel(value: string) {
  return isPenalGrade(value) ? `Penal Grade ${value}` : 'Ungültiger Penal Grade'
}
