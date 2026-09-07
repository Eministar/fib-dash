/**
 * Aktenzeichen einer Bewerbung — "BW-0001", fortlaufend und ohne Jahreswechsel.
 *
 * Bewusst frei von Prisma-Importen: die Helfer laufen auch in Client-Komponenten
 * (HR-Liste, Bewerberportal).
 */
export const APPLICATION_CASE_PREFIX = 'BW-'

const CASE_NUMBER_PATTERN = /^BW-(\d{1,10})$/i
/** "BW-0001 | Max Mustermann" → erkennt das vorangestellte Aktenzeichen. */
const CASE_PREFIX_IN_NAME = /^\s*BW-\d{1,10}\s*\|\s*/i

export function formatApplicationCaseNumber(value: number) {
  return `${APPLICATION_CASE_PREFIX}${String(Math.max(1, Math.trunc(value))).padStart(4, '0')}`
}

export function parseApplicationCaseNumber(value: string | null | undefined) {
  const match = CASE_NUMBER_PATTERN.exec(value?.trim() ?? '')
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Entfernt ein bereits vorangestelltes Aktenzeichen, damit es nicht doppelt wächst. */
export function stripApplicationCaseNumber(value: string) {
  return value.replace(CASE_PREFIX_IN_NAME, '').replace(/\s+/g, ' ').trim()
}

/**
 * Anzeigename eines Bewerbers: "BW-0001 | Vorname Nachname". Ohne Namen bleibt
 * nur das Aktenzeichen übrig — besser als ein Name ohne Kennung.
 */
export function buildApplicantDisplayName(caseNumber: string, name: string) {
  const cleanName = stripApplicationCaseNumber(name)
  const cleanCase = caseNumber.trim()
  if (!cleanCase) return cleanName
  return cleanName ? `${cleanCase} | ${cleanName}` : cleanCase
}
