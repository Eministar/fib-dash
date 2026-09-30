/**
 * Gemeinsame Definitionen der Personalakte (Zeitstrahl). Bewusst ohne
 * Server-Importe, damit Route und Seite dieselben Kategorien benutzen.
 */

export const TIMELINE_CATEGORIES = [
  'rank',
  'sanction',
  'training',
  'absence',
  'note',
  'record',
  'status',
  'probation',
  'calendar',
  'duty',
  'audit',
] as const

export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number]

export const TIMELINE_CATEGORY_LABELS: Record<TimelineCategory, string> = {
  rank: 'Beförderungen',
  sanction: 'Sanktionen',
  training: 'Ausbildungen',
  absence: 'Abmeldungen',
  note: 'Notizen',
  record: 'Akteneinträge',
  status: 'Einstellung & Kündigung',
  probation: 'Probezeit',
  calendar: 'Termine',
  duty: 'Dienstzeiten',
  audit: 'Protokoll',
}

/**
 * Standardauswahl: alles, was eine Personalakte ausmacht. Dienstzeiten und
 * Protokoll sind bei aktiven Agents hunderte Einträge und würden das
 * Wesentliche verdecken – die schaltet man bei Bedarf dazu.
 */
export const DEFAULT_TIMELINE_CATEGORIES: TimelineCategory[] = TIMELINE_CATEGORIES.filter(
  (category) => category !== 'duty' && category !== 'audit',
)

/** Tonalität für den Punkt am Zeitstrahl – bewusst zurückhaltend. */
export type TimelineTone = 'positive' | 'negative' | 'neutral'

export type TimelineDetail = { label: string; value: string }

export type TimelineEntry = {
  id: string
  /** Veralteter Typ-Name (hire, promotion, sanction …) – nur für bestehende API-Nutzer. */
  type?: string
  /** Veraltet, identisch mit `occurredAt`. */
  createdAt?: string
  category: TimelineCategory
  tone: TimelineTone
  title: string
  description: string | null
  occurredAt: string
  details: TimelineDetail[]
}

export type TimelineAgent = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rankName: string
  status: string
  hireDate: string
}

export type TimelineResponse = {
  agent: TimelineAgent
  items: TimelineEntry[]
}

/** „1 Std. 30 Min.“ – für Dienst- und Spielzeiten. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} Min.`
  return minutes === 0 ? `${hours} Std.` : `${hours} Std. ${minutes} Min.`
}

export function parseTimelineCategories(raw: string | null | undefined): TimelineCategory[] {
  if (!raw) return DEFAULT_TIMELINE_CATEGORIES
  const picked = raw.split(',').filter((value): value is TimelineCategory => (TIMELINE_CATEGORIES as readonly string[]).includes(value))
  return picked.length > 0 ? picked : DEFAULT_TIMELINE_CATEGORIES
}
