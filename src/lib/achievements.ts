/**
 * Abzeichen der Personalakte. Werden bei jedem Abruf aus vorhandenen Daten
 * berechnet und nirgends gespeichert – eine Korrektur der Daten (z. B. ein
 * zurückdatiertes Einstellungsdatum) wirkt deshalb sofort.
 */

import { monthKeyLabel } from '@/lib/agent-of-month'

export type AchievementCategory = 'service' | 'duty' | 'training' | 'cases' | 'honor'

export type Achievement = {
  id: string
  category: AchievementCategory
  title: string
  description: string
  /** 1 = Bronze, 2 = Silber, 3 = Gold – steuert nur die Optik. */
  tier: 1 | 2 | 3
}

export type AchievementInput = {
  hireDate: Date
  totalDutyMs: number
  completedTrainings: number
  closedCasesLed: number
  /** Monate ("YYYY-MM"), in denen der Agent Agent des Monats war. */
  agentOfMonthWins: string[]
  now?: Date
}

const HOUR_MS = 3_600_000

type Step = { min: number; title: string; tier: 1 | 2 | 3 }

/** Höchste erreichte Stufe einer Leiter, oder `null`. */
function reached(value: number, steps: Step[]): Step | null {
  return steps.filter((step) => value >= step.min).at(-1) ?? null
}

/** Volle Kalendermonate zwischen zwei Daten. */
export function fullMonthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months -= 1
  return Math.max(0, months)
}

const SERVICE: Step[] = [
  { min: 1, title: '1 Monat dabei', tier: 1 },
  { min: 3, title: '3 Monate dabei', tier: 1 },
  { min: 6, title: 'Ein halbes Jahr dabei', tier: 2 },
  { min: 12, title: 'Ein Jahr dabei', tier: 3 },
  { min: 24, title: 'Zwei Jahre dabei', tier: 3 },
]

const DUTY: Step[] = [
  { min: 50, title: '50 Dienststunden', tier: 1 },
  { min: 100, title: '100 Dienststunden', tier: 2 },
  { min: 250, title: '250 Dienststunden', tier: 2 },
  { min: 500, title: '500 Dienststunden', tier: 3 },
]

const TRAINING: Step[] = [
  { min: 1, title: 'Erste Ausbildung', tier: 1 },
  { min: 5, title: '5 Ausbildungen', tier: 2 },
  { min: 10, title: '10 Ausbildungen', tier: 3 },
]

const CASES: Step[] = [
  { min: 1, title: 'Erster Fall abgeschlossen', tier: 1 },
  { min: 5, title: '5 Fälle abgeschlossen', tier: 2 },
  { min: 10, title: '10 Fälle abgeschlossen', tier: 3 },
]

export function computeAchievements(input: AchievementInput): Achievement[] {
  const now = input.now ?? new Date()
  const months = fullMonthsBetween(input.hireDate, now)
  const hours = Math.floor(input.totalDutyMs / HOUR_MS)
  const result: Achievement[] = []

  const service = reached(months, SERVICE)
  if (service) result.push({ id: `service-${service.min}`, category: 'service', title: service.title, description: `Seit ${months} ${months === 1 ? 'Monat' : 'Monaten'} beim FIB`, tier: service.tier })

  const duty = reached(hours, DUTY)
  if (duty) result.push({ id: `duty-${duty.min}`, category: 'duty', title: duty.title, description: `${hours} Stunden Dienstzeit insgesamt`, tier: duty.tier })

  const training = reached(input.completedTrainings, TRAINING)
  if (training) result.push({ id: `training-${training.min}`, category: 'training', title: training.title, description: `${input.completedTrainings} abgeschlossene Ausbildungen`, tier: training.tier })

  const cases = reached(input.closedCasesLed, CASES)
  if (cases) result.push({ id: `cases-${cases.min}`, category: 'cases', title: cases.title, description: `${input.closedCasesLed} Ermittlungen als Fallführung abgeschlossen`, tier: cases.tier })

  const wins = [...input.agentOfMonthWins].sort()
  if (wins.length > 0) {
    result.push({
      id: 'agent-of-month',
      category: 'honor',
      title: wins.length === 1 ? 'Agent des Monats' : `${wins.length}× Agent des Monats`,
      description: wins.map(monthKeyLabel).join(', '),
      tier: wins.length >= 3 ? 3 : wins.length === 2 ? 2 : 1,
    })
  }

  return result
}
