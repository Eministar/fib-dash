/**
 * Fortlaufende Aktenzeichen im Format `<PREFIX><0001>` — genutzt für Anzeigen
 * ("AZ-"), Personenakten ("PA-") und Versetzungsanträge ("VA-").
 *
 * Bewusst ohne Prisma-Import: die Helfer laufen auch in Client-Komponenten.
 */
export function formatSequenceNumber(prefix: string, value: number, width = 4) {
  return `${prefix}${String(Math.max(1, Math.trunc(value))).padStart(width, '0')}`
}

export function parseSequenceNumber(prefix: string, value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw.toUpperCase().startsWith(prefix.toUpperCase())) return null

  const digits = raw.slice(prefix.length)
  if (!/^\d{1,10}$/.test(digits)) return null

  const parsed = Number.parseInt(digits, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Nächste freie Nummer aus einer Liste vorhandener Aktenzeichen. Bewusst über
 * alle Werte statt über eine DB-Sortierung: die Nummern sind gepolstert, ab
 * fünf Stellen würde eine String-Sortierung die höchste falsch bestimmen.
 */
export function nextSequenceNumber(prefix: string, existing: (string | null | undefined)[]) {
  const highest = existing.reduce<number>(
    (max, value) => Math.max(max, parseSequenceNumber(prefix, value) ?? 0),
    0,
  )
  return formatSequenceNumber(prefix, highest + 1)
}
