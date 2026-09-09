/**
 * Gemeinsame Typen und Regeln der Bereichssuche. Bewusst frei von
 * Server-Importen, damit Route Handler und Client-Komponenten dieselbe
 * Quelle benutzen.
 */

export const SEARCH_GROUPS = {
  investigations: 'Einsatzakten',
  dossiers: 'Dauerakten',
  persons: 'Personen',
  vehicles: 'Fahrzeuge',
  mapSpots: 'Kartenpunkte',
  entries: 'Chronologie-Einträge',
} as const

export type SearchGroup = keyof typeof SEARCH_GROUPS

export type SearchHit = {
  id: string
  group: SearchGroup
  /** Aktenzeichen, Kennzeichen oder Kategorie – die Zeile über dem Titel. */
  code?: string
  title: string
  /** Fundstelle im Kontext, damit man sieht, warum der Treffer kam. */
  hint?: string
  href: string
  classified?: boolean
}

/** Pro Gruppe, damit eine große Gruppe die anderen nicht verdrängt. */
export const SEARCH_LIMIT_PER_GROUP = 6

/** Kürzester Suchbegriff. Ein Zeichen träfe faktisch alles. */
export const SEARCH_MIN_LENGTH = 2

/**
 * Schneidet einen Textausschnitt um die Fundstelle heraus, damit man den
 * Treffer im Kontext sieht statt nur den Anfang eines langen Feldes.
 */
export function excerpt(text: string | null | undefined, term: string, radius = 45): string | undefined {
  if (!text) return undefined
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined

  const position = clean.toLowerCase().indexOf(term.toLowerCase())
  if (position < 0) return clean.length > radius * 2 ? `${clean.slice(0, radius * 2)}…` : clean

  const start = Math.max(0, position - radius)
  const end = Math.min(clean.length, position + term.length + radius)
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`
}
