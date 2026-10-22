import { z } from 'zod'

/**
 * Gespeicherte Filteransichten einer Liste – im Browser je Konto abgelegt.
 * Reine Logik, damit Agenten- und Aktenliste dieselben Regeln teilen.
 */
export const SAVED_VIEWS_LIMIT = 20

export function savedViewsSchema<F extends z.ZodTypeAny>(filters: F) {
  return z.array(z.object({
    id: z.string().max(100),
    name: z.string().trim().min(1).max(50),
    filters,
  })).max(SAVED_VIEWS_LIMIT)
}

export type SavedView<F> = { id: string; name: string; filters: F }

export function readSavedViews<F>(raw: string | null, schema: z.ZodType<SavedView<F>[]>): SavedView<F>[] {
  try {
    const result = schema.safeParse(JSON.parse(raw ?? '[]'))
    return result.success ? result.data : []
  } catch { return [] }
}

/** Vergleicht nur die Schlüssel der leeren Vorlage – zusätzliche Felder zählen nicht. */
export function sameFilters<F extends Record<string, unknown>>(a: F, b: F, empty: F) {
  return (Object.keys(empty) as (keyof F)[]).every((key) => a[key] === b[key])
}
