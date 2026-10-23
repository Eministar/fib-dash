/**
 * Treffer über Fälle hinweg: Wird eine Person oder ein Kennzeichen erfasst,
 * soll sofort auffallen, wenn sie schon in anderen Ermittlungen vorkommt.
 * Reine Hilfsfunktionen – auch vom Client nutzbar.
 */

export interface CaseRef {
  id: string
  caseNumber: string
  title: string
}

export interface PersonCrossHit {
  kind: 'person'
  id: string
  code: string
  name: string
  /** Woran der Treffer erkannt wurde, z. B. ["Name", "Telefon"]. */
  matchedOn: string[]
  investigations: CaseRef[]
}

export interface VehicleCrossHit {
  kind: 'vehicle'
  id: string
  code: string
  name: string
  matchedOn: string[]
  investigations: CaseRef[]
}

export type CrossHit = PersonCrossHit | VehicleCrossHit

/** Je Person/Fahrzeug: weitere (für den Nutzer sichtbare) Akten außer der aktuellen. */
export interface CaseCrossHits {
  persons: Record<string, CaseRef[]>
  vehicles: Record<string, CaseRef[]>
}

/** „ls-123 ab“ und „LS 123AB“ sind dasselbe Kennzeichen. */
export function normalizePlate(value: string | null | undefined) {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Vergleichsform für Namen, Alias, Kennung: klein, ohne Akzente und Mehrfach-Leerzeichen. */
export function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Telefonnummern nur über ihre Ziffern vergleichen. */
export function normalizePhone(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

export interface PersonProbe {
  firstName?: string | null
  lastName?: string | null
  alias?: string | null
  identifier?: string | null
  phone?: string | null
}

/** Mindestlänge, ab der ein Feld als Suchmerkmal taugt. */
const MIN_PHONE_DIGITS = 4

/**
 * Welche Merkmale einer bestehenden Person zu den Eingaben passen. Name zählt
 * nur vollständig (Vor- UND Nachname), sonst träfe jeder „Müller“.
 */
export function personMatchReasons(probe: PersonProbe, candidate: PersonProbe): string[] {
  const reasons: string[] = []

  const first = normalizeText(probe.firstName)
  const last = normalizeText(probe.lastName)
  if (
    first &&
    last &&
    first === normalizeText(candidate.firstName) &&
    last === normalizeText(candidate.lastName)
  ) {
    reasons.push('Name')
  }

  const alias = normalizeText(probe.alias)
  if (alias.length >= 2) {
    const candidateAlias = normalizeText(candidate.alias)
    const candidateName = normalizeText(`${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`)
    if (alias === candidateAlias || alias === candidateName) reasons.push('Alias')
  }

  const identifier = normalizeText(probe.identifier)
  if (identifier.length >= 2 && identifier === normalizeText(candidate.identifier)) reasons.push('Kennung')

  const phone = normalizePhone(probe.phone)
  if (phone.length >= MIN_PHONE_DIGITS && phone === normalizePhone(candidate.phone)) reasons.push('Telefon')

  return reasons
}

/** Ob die Eingaben überhaupt genug für eine Suche hergeben. */
export function personProbeIsSearchable(probe: PersonProbe) {
  return (
    (normalizeText(probe.firstName).length > 0 && normalizeText(probe.lastName).length > 0) ||
    normalizeText(probe.alias).length >= 2 ||
    normalizeText(probe.identifier).length >= 2 ||
    normalizePhone(probe.phone).length >= MIN_PHONE_DIGITS
  )
}

/** Kennzeichen ab drei Zeichen – darunter trifft es zu viel. */
export function plateIsSearchable(plate: string | null | undefined) {
  return normalizePlate(plate).length >= 3
}

/**
 * Längster zusammenhängender Block aus Buchstaben/Ziffern. Damit grenzt die
 * Datenbank grob vor (`contains`), die genaue Prüfung macht `normalizePlate`.
 */
export function plateSearchChunk(plate: string) {
  const chunks = plate.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  return chunks.reduce((longest, chunk) => (chunk.length > longest.length ? chunk : longest), '')
}

/**
 * Gruppiert Verknüpfungen zu „weitere Akten je Person/Fahrzeug“ und lässt die
 * aktuelle Akte weg. Doppelte Rollen derselben Person in einer Akte zählen einmal.
 */
export function groupOtherCases(
  links: { key: string; investigation: CaseRef }[],
  currentInvestigationId: string,
): Record<string, CaseRef[]> {
  const result: Record<string, CaseRef[]> = {}
  for (const link of links) {
    if (link.investigation.id === currentInvestigationId) continue
    const list = (result[link.key] ??= [])
    if (!list.some((item) => item.id === link.investigation.id)) list.push(link.investigation)
  }
  return result
}
