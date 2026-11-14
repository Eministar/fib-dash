/**
 * Straftatbestände einer Ermittlungsakte: gegen welche Normen wurde verstoßen.
 * Gespeichert wird ein Abbild der Norm (Fundstelle + Überschrift), damit die
 * Akte lesbar bleibt, auch wenn das Gesetzbuch später umnummeriert wird.
 * Reine Funktionen – im Browser wie auf dem Server nutzbar.
 */

export type Charge = {
  /** Verweis ins Gesetzbuch, z. B. `stgb:p9`. */
  ref: string
  /** `§ 9 StGB` */
  label: string
  /** `Diebstahl` */
  title: string
}

export const MAX_CHARGES = 30

/** Gespeicherte Daten tolerant lesen. */
export function readCharges(value: unknown): Charge[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const ref = typeof raw.ref === 'string' ? raw.ref.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!ref || !label || seen.has(ref)) return []
    seen.add(ref)
    return [{ ref, label, title: typeof raw.title === 'string' ? raw.title.trim() : '' }]
  }).slice(0, MAX_CHARGES)
}

export function chargeLine(charge: Charge) {
  return charge.title ? `${charge.label} – ${charge.title}` : charge.label
}

/** Mehrere Akten zusammenführen, ohne Doppelte, Reihenfolge bleibt. */
export function mergeCharges(...lists: Charge[][]) {
  const seen = new Set<string>()
  return lists.flat().filter((charge) => !seen.has(charge.ref) && !!seen.add(charge.ref)).slice(0, MAX_CHARGES)
}
