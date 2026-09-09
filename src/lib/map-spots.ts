/**
 * Kategorien und Typen der Stadtkarte. Bewusst frei von Server-Importen,
 * damit Route Handler und Client-Komponenten dieselbe Quelle benutzen.
 */

export const MAP_CATEGORIES = [
  { id: 'weed', label: 'Weed', hex: '#44dd44', icon: '🌿' },
  { id: 'lsd', label: 'LSD', hex: '#cc44ff', icon: '🔮' },
  { id: 'kokain', label: 'Kokain', hex: '#a9b7c4', icon: '❄' },
  { id: 'heroin', label: 'Heroin', hex: '#ff8800', icon: '💉' },
  { id: 'waffen', label: 'Waffen', hex: '#ff3333', icon: '🔫' },
  { id: 'munition', label: 'Munition', hex: '#ffcc00', icon: '🎯' },
  { id: 'schwarzmarkt', label: 'Schwarzmarkt', hex: '#888888', icon: '🖤' },
  { id: 'other', label: 'Sonstiges', hex: '#aaaaaa', icon: '📍' },
] as const

export type MapCategory = (typeof MAP_CATEGORIES)[number]['id']

export const MAP_CATEGORY_IDS = MAP_CATEGORIES.map((category) => category.id) as [
  MapCategory,
  ...MapCategory[],
]

const CATEGORY_BY_ID = new Map(MAP_CATEGORIES.map((category) => [category.id as string, category]))

/** Fällt auf „Sonstiges“ zurück, damit eine später entfernte Kategorie die Karte nicht zerlegt. */
export function mapCategory(id: string) {
  return CATEGORY_BY_ID.get(id) ?? MAP_CATEGORIES[MAP_CATEGORIES.length - 1]
}

export const MAP_SPOT_LIMITS = {
  title: 80,
  description: 1000,
  icon: 16,
} as const

/** Seitenverhältnis des Kartenbilds unter `src/assets/map.png`. */
export const MAP_WIDTH = 6144
export const MAP_HEIGHT = 9216

export interface MapSpot {
  id: string
  title: string
  description: string
  category: MapCategory
  icon: string | null
  /** Position in Prozent der Kartenbreite bzw. -höhe (0–100). */
  x: number
  y: number
  /** Dauerakten, die diesen Punkt als Route, Sammler oder Anwesen führen. */
  dossiers: { id: string; title: string; kind: string }[]
  /** Einsatzakten an diesem Punkt – bereits sichtbarkeitsgefiltert. */
  investigations: { id: string; caseNumber: string; title: string; classified: boolean }[]
  createdById: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}
