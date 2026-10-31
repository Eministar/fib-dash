/** Reine Hilfsfunktionen für „Agent der Woche“ – ohne Datenbank, auch im Client nutzbar. */

const TIME_ZONE = 'Europe/Berlin'
const DAY_MS = 86_400_000

export const RATING_CATEGORIES = [
  { key: 'shooting', label: 'Schießen', short: 'Schießen', emoji: '🎯' },
  { key: 'work', label: 'Allgemeine Arbeit', short: 'Arbeit', emoji: '🗂️' },
  { key: 'activity', label: 'Aktivität', short: 'Aktivität', emoji: '⚡' },
  { key: 'roleplay', label: 'RP-Künste', short: 'RP-Künste', emoji: '🎭' },
] as const

export type RatingCategory = (typeof RATING_CATEGORIES)[number]['key']
export type RatingScores = Record<RatingCategory, number>

export const MIN_SCORE = 1
export const MAX_SCORE = 10

/** Bewertet werden kurz Abgemeldete, aber keine Beurlaubten oder Ausgeschiedenen. */
export const RATEABLE_STATUSES = ['ACTIVE', 'AWAY'] as const

export function isRateableStatus(status: string) {
  return (RATEABLE_STATUSES as readonly string[]).includes(status)
}

function isoWeekOf(year: number, month: number, day: number) {
  const target = new Date(Date.UTC(year, month - 1, day))
  const weekday = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 1)
  return { year: target.getUTCFullYear(), week: Math.ceil(((target.getTime() - yearStart) / DAY_MS + 1) / 7) }
}

/** ISO-Wochenschlüssel "YYYY-Www" in deutscher Zeit – die Woche wechselt Montag 00:00 MEZ/MESZ. */
export function weekKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const { year, week } = isoWeekOf(value('year'), value('month'), value('day'))
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function isWeekKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value)
}

/** Montag der Woche als UTC-Mittag – fällt in jeder Zeitzone auf denselben Kalendertag. */
function mondayOf(key: string) {
  const [year, week] = key.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(year, 0, 4, 12))
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS)
  return new Date(monday.getTime() + (week - 1) * 7 * DAY_MS)
}

export function shiftWeekKey(key: string, offset: number): string {
  const monday = new Date(mondayOf(key).getTime() + offset * 7 * DAY_MS)
  const { year, week } = isoWeekOf(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** "KW 44 · 26.10.–01.11.2026" */
export function weekKeyLabel(key: string): string {
  const monday = mondayOf(key)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  const short = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
  return `KW ${Number(key.split('-W')[1])} · ${short.format(monday)}–${long.format(sunday)}`
}

/** "KW 44" */
export function weekKeyShort(key: string): string {
  return `KW ${Number(key.split('-W')[1])}`
}

export function isValidScore(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_SCORE && (value as number) <= MAX_SCORE
}

export type RatingRow = { agentId: string } & RatingScores

export type AgentWeekScore = RatingScores & {
  agentId: string
  ratingCount: number
  /** Mittel der vier Kategorie-Mittel – alle Kategorien zählen gleich. */
  overall: number
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

export function aggregateRatings(rows: RatingRow[]): AgentWeekScore[] {
  const byAgent = new Map<string, RatingRow[]>()
  for (const row of rows) byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), row])
  return [...byAgent].map(([agentId, list]) => {
    const scores = Object.fromEntries(RATING_CATEGORIES.map(({ key }) => [key, mean(list.map((row) => row[key]))])) as RatingScores
    return { agentId, ratingCount: list.length, ...scores, overall: mean(RATING_CATEGORIES.map(({ key }) => scores[key])) }
  })
}

export type RankedScore = AgentWeekScore & {
  place: number
  /**
   * Genug Bewertungen für den Titel: mindestens die Hälfte der meistbewerteten
   * Agents. Sonst gewänne eine einzelne 10/10 gegen fünfzehn Neunen.
   */
  qualified: boolean
}

export function minimumRatings(scores: AgentWeekScore[]) {
  return Math.max(1, Math.ceil(Math.max(0, ...scores.map((score) => score.ratingCount)) / 2))
}

/** Gewertete zuerst nach Gesamtnote, danach die mit zu wenigen Bewertungen. Gleiche Note = gleicher Platz. */
export function rankScores(scores: AgentWeekScore[]): RankedScore[] {
  const minimum = minimumRatings(scores)
  const sorted = scores
    .map((score) => ({ ...score, qualified: score.ratingCount >= minimum }))
    .sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.overall - a.overall || b.ratingCount - a.ratingCount || a.agentId.localeCompare(b.agentId))
  const ranked: RankedScore[] = []
  sorted.forEach((score, index) => {
    const previous = ranked[index - 1]
    const tied = previous && previous.qualified === score.qualified && sameScore(previous.overall, score.overall)
    ranked.push({ ...score, place: tied ? previous.place : index + 1 })
  })
  return ranked
}

function sameScore(a: number, b: number) {
  return Math.abs(a - b) < 1e-9
}

/** Alle Gewerteten auf Platz 1; leer, wenn niemand bewertet wurde. */
export function weekWinners(ranked: RankedScore[]): RankedScore[] {
  return ranked.filter((score) => score.qualified && score.place === 1)
}

/** Grund, warum eine Bewertung nicht zählt – oder `null`, wenn sie gültig ist. */
export function ratingRejection(input: { raterAgentId: string | null; agentId: string; agentStatus: string }): string | null {
  if (!input.raterAgentId) return 'Bewerten können nur Nutzer mit verknüpftem Agent.'
  if (input.raterAgentId === input.agentId) return 'Dich selbst kannst du nicht bewerten.'
  if (!isRateableStatus(input.agentStatus)) return 'Dieser Agent kann diese Woche nicht bewertet werden.'
  return null
}

/** "8,7" */
export function formatScore(value: number) {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Zehnteiliger Balken für Discord, z. B. "▰▰▰▰▰▰▰▰▱▱". */
export function scoreBar(value: number, length = 10) {
  const filled = Math.max(0, Math.min(length, Math.round((value / MAX_SCORE) * length)))
  return '▰'.repeat(filled) + '▱'.repeat(length - filled)
}

export function placeIcon(place: number) {
  return place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `${place}.`
}
