/**
 * Gespeicherte Filteransichten einer Liste – im Browser je Konto abgelegt.
 * Reine Logik, damit Agenten- und Aktenliste dieselben Regeln teilen.
 * Bewusst ohne zod: die Prüfung läuft im Browser, und zod würde dafür rund
 * 60 KB auf jede Liste laden.
 */
export const SAVED_VIEWS_LIMIT = 20
const MAX_ID = 100
const MAX_NAME = 50

export type SavedView<F> = { id: string; name: string; filters: F }

/** Prüft die Filter einer Ansicht; `null` heißt ungültig. */
export type FilterValidator<F> = (value: unknown) => F | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Prüfbausteine für Filterfelder. */
export const field = {
  text: (max: number) => (value: unknown) => (typeof value === 'string' && value.length <= max ? value : undefined),
  oneOf: <T extends string>(options: readonly T[]) => (value: unknown) =>
    (typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : undefined),
  flag: () => (value: unknown) => (typeof value === 'boolean' ? value : undefined),
}

/** Baut aus Feldprüfungen einen Validator; jedes Feld ist Pflicht, fremde Felder fallen weg. */
export function filterValidator<F extends Record<string, unknown>>(fields: { [K in keyof F]: (value: unknown) => F[K] | undefined }): FilterValidator<F> {
  return (value) => {
    if (!isRecord(value)) return null
    const result = {} as F
    for (const key of Object.keys(fields) as (keyof F)[]) {
      const parsed = fields[key](value[key as string])
      if (parsed === undefined) return null
      result[key] = parsed
    }
    return result
  }
}

/** Alle Ansichten gültig? Prüft Anzahl, Namen und Filter. */
export function validSavedViews<F>(views: unknown, validate: FilterValidator<F>): views is SavedView<F>[] {
  if (!Array.isArray(views) || views.length > SAVED_VIEWS_LIMIT) return false
  return views.every((view) => isRecord(view)
    && typeof view.id === 'string' && view.id.length <= MAX_ID
    && typeof view.name === 'string' && view.name.trim().length >= 1 && view.name.trim().length <= MAX_NAME
    && validate(view.filters) !== null)
}

export function readSavedViews<F>(raw: string | null, validate: FilterValidator<F>): SavedView<F>[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    if (!validSavedViews(parsed, validate)) return []
    return parsed.map((view) => ({ id: view.id, name: view.name.trim(), filters: validate(view.filters)! }))
  } catch { return [] }
}

/** Vergleicht nur die Schlüssel der leeren Vorlage – zusätzliche Felder zählen nicht. */
export function sameFilters<F extends Record<string, unknown>>(a: F, b: F, empty: F) {
  return (Object.keys(empty) as (keyof F)[]).every((key) => a[key] === b[key])
}
