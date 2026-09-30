/**
 * Gemeinsame Suchlogik für alle Listen im Dashboard.
 *
 * Vorher hatte jede Liste ihre eigene `includes()`-Kette – mit denselben
 * Lücken überall: „Max Mustermann“ fand nichts (Vor- und Nachname wurden nur
 * einzeln verglichen), „7“ fand die Dienstnummer „07“ nicht gezielt, und eine
 * Discord-ID griff nur, wenn sie vollständig und ohne Leerzeichen eingegeben
 * wurde. Diese Datei ist bewusst frei von Server- und React-Importen, damit
 * Client-Listen und Route Handler dieselben Regeln benutzen.
 *
 * Regeln:
 * - Groß-/Kleinschreibung, Akzente, ß/ss und ä/ae sind egal.
 * - Mehrere Wörter: JEDES Wort muss irgendwo passen („max 12“, „müller detective“).
 * - Kurze Zahlen (≤ 4 Ziffern) sind Dienst-/Aktennummern: „7“ passt auf „07“,
 *   „FIB-007“ oder „#7“, aber nicht auf „17“ oder „170“.
 * - Lange Zahlen (≥ 5 Ziffern) sind IDs: Teilstücke reichen, Leerzeichen und
 *   Discord-Erwähnungen (`<@123…>`) werden ignoriert.
 */

type Field = string | number | null | undefined

const SHORT_NUMBER_MAX_DIGITS = 4

export function normalizeSearchText(value: Field): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    // „Mueller“ und „Müller“ sollen sich finden: beide Seiten laufen durch dieselbe Regel.
    .replace(/([aou])e/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zerlegt die Eingabe in Suchwörter. Discord-Erwähnungen und in Ziffern verteilte Leerzeichen werden zusammengezogen. */
export function searchTokens(query: string): string[] {
  const cleaned = normalizeSearchText(query)
    // <@123>, <@!123>, @123 → 123
    .replace(/<@!?(\d+)>/g, '$1')
    .replace(/(^|\s)@(\d{5,})/g, '$1$2')
    // „1234 5678 9012“ (kopierte IDs mit Leerzeichen) → eine Zahl, aber nur bei langen Zahlenfolgen
    .replace(/\d[\d ]{8,}\d/g, (match) => match.replace(/ /g, ''))
  return cleaned.split(' ').map((token) => token.replace(/^[#,;]+|[,;.]+$/g, '')).filter(Boolean)
}

function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? []
}

function tokenMatchesField(token: string, field: string): boolean {
  if (!field) return false
  if (/^\d+$/.test(token) && token.length <= SHORT_NUMBER_MAX_DIGITS) {
    // Kurze Zahl: nur ganze Zahlengruppen vergleichen, führende Nullen egal.
    const wanted = Number.parseInt(token, 10)
    return digitRuns(field).some((run) => run.length <= SHORT_NUMBER_MAX_DIGITS + 2 && Number.parseInt(run, 10) === wanted)
  }
  if (/^\d+$/.test(token)) {
    return field.replace(/\s+/g, '').includes(token)
  }
  return field.includes(token)
}

/**
 * Prüft, ob alle Suchwörter in den Feldern vorkommen. Leere Suche passt immer.
 * Felder dürfen `null`/`undefined` sein.
 */
export function matchesSearch(query: string, fields: Field[]): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const normalized = fields.map(normalizeSearchText).filter(Boolean)
  if (normalized.length === 0) return false
  // Vollständiger Name über Feldgrenzen hinweg („max mustermann“ als ein Wort-Paar).
  const combined = normalized.join(' ')
  return tokens.every((token) => normalized.some((field) => tokenMatchesField(token, field)) || tokenMatchesField(token, combined))
}

export type SearchableAgent = {
  firstName?: string | null
  lastName?: string | null
  badgeNumber?: string | null
  discordId?: string | null
  user?: { discordId?: string | null; displayName?: string | null } | null
  rank?: { name?: string | null } | null
  codename?: { name?: string | null } | string | null
}

/** Alle Felder, über die man einen Agent finden können soll. */
export function agentSearchFields(agent: SearchableAgent | null | undefined): Field[] {
  if (!agent) return []
  const codename = typeof agent.codename === 'string' ? agent.codename : agent.codename?.name
  return [
    agent.firstName,
    agent.lastName,
    // Auch „Mustermann, Max“ und Dienstnummer ohne Präfix finden.
    agent.firstName && agent.lastName ? `${agent.firstName} ${agent.lastName}` : null,
    agent.badgeNumber?.replace(/__terminated__.*$/, ''),
    agent.discordId,
    agent.user?.discordId,
    agent.user?.displayName,
    agent.rank?.name,
    codename,
  ]
}

export function matchesAgent(query: string, agent: SearchableAgent | null | undefined, extraFields: Field[] = []): boolean {
  return matchesSearch(query, [...agentSearchFields(agent), ...extraFields])
}

/**
 * Sortiert Treffer nach Relevanz: exakte Dienstnummer / ID vor Namensanfang
 * vor allem anderen. Stabil – gleich gute Treffer behalten ihre Reihenfolge.
 */
export function agentMatchScore(query: string, agent: SearchableAgent): number {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return 0
  const badge = normalizeSearchText(agent.badgeNumber)
  const ids = [agent.discordId, agent.user?.discordId].map(normalizeSearchText)
  const first = normalizeSearchText(agent.firstName)
  const last = normalizeSearchText(agent.lastName)
  let score = 0
  for (const token of tokens) {
    if (ids.includes(token)) score += 100
    else if (/^\d+$/.test(token) && digitRuns(badge).some((run) => Number.parseInt(run, 10) === Number.parseInt(token, 10))) score += 80
    else if (first.startsWith(token) || last.startsWith(token)) score += 40
    else if (first.includes(token) || last.includes(token)) score += 10
  }
  return score
}

/**
 * Suchwörter für Datenbankabfragen. Anders als `searchTokens` ohne eigene
 * Normalisierung – Groß/Klein und Umlaute übernimmt die Datenbank-Collation.
 */
export function sqlSearchTokens(query: string | null | undefined): string[] {
  return (query ?? '')
    .trim()
    .replace(/<@!?(\d+)>/g, '$1')
    .replace(/\d[\d ]{8,}\d/g, (match) => match.replace(/ /g, ''))
    .split(/\s+/)
    .map((token) => token.replace(/^[#@,;]+|[,;.]+$/g, ''))
    .filter(Boolean)
    .slice(0, 6)
}

/**
 * Baut eine Prisma-Bedingung: JEDES Suchwort muss in mindestens einem Feld
 * vorkommen. So findet „Max Mustermann“ den Datensatz, obwohl Vor- und
 * Nachname in getrennten Spalten stehen. `undefined` bei leerer Suche.
 */
export function tokenizedWhere<T>(query: string | null | undefined, fieldsFor: (token: string) => T[]): { AND: { OR: T[] }[] } | undefined {
  const tokens = sqlSearchTokens(query)
  if (tokens.length === 0) return undefined
  return { AND: tokens.map((token) => ({ OR: fieldsFor(token) })) }
}
