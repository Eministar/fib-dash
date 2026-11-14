import fallback from '@/data/laws.json'
import { fetchLawbook, type Law, type LawNorm, type Lawbook } from './fjd-parser'

/**
 * Gesetzbuch von Nerowood – live vom Federal Justice Department
 * (https://fjd.kian-hahn.de/recht). Der Server lädt es beim ersten Bedarf und
 * hält es {@link FRESH_MS} im Speicher; danach wird im Hintergrund neu geladen,
 * die Anfrage wartet nicht. Ist die Seite nicht erreichbar, gilt der letzte
 * erfolgreiche Stand bzw. die mitgelieferte Notfallkopie `src/data/laws.json`.
 * Nur auf dem Server importieren – der Browser holt die Normen über `/api/laws`.
 */

export type { Law, LawNorm }

/** Eine Norm mit Gesetz – so, wie Picker, KI und Dokumente sie brauchen. */
export type NormEntry = {
  /** Eindeutig und stabil: `stgb:p9`. */
  ref: string
  law: string
  lawName: string
  group: string
  /** `§ 9 StGB` */
  label: string
  title: string
  section: string | null
  text: string
  url: string
  /** Die Norm droht eine Strafe an (Straftatbestand / Ordnungswidrigkeit). */
  penal: boolean
}

export type LawCatalog = {
  source: string
  syncedAt: string
  /** `live` = gerade von der FJD-Seite, `fallback` = Notfallkopie. */
  origin: 'live' | 'fallback'
  laws: Law[]
  norms: NormEntry[]
  find: (ref: string) => NormEntry | null
  /** Fundstelle tolerant auflösen: `stgb:p9`, `§ 9 StGB`, `StGB 9` … */
  resolve: (input: string) => NormEntry | null
}

const FRESH_MS = 30 * 60_000
const RETRY_MS = 2 * 60_000
const PENAL = /bestraft|Freiheitsstrafe|Geldstrafe|Geldbuße|geahndet/i

function toEntry(law: Law, norm: LawNorm): NormEntry {
  return {
    ref: `${law.code}:${norm.id}`,
    law: law.abbr,
    lawName: law.name,
    group: law.group,
    label: norm.title ? `${norm.number} ${law.abbr}` : `${law.abbr} ${norm.number}`,
    title: norm.title,
    section: norm.section,
    text: norm.text,
    url: `${law.url}#${norm.id}`,
    penal: PENAL.test(norm.text),
  }
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildCatalog(book: Lawbook, origin: LawCatalog['origin']): LawCatalog {
  const norms = book.laws.flatMap((law) => law.norms.map((norm) => toEntry(law, norm)))
  const byRef = new Map(norms.map((norm) => [norm.ref, norm]))
  const find = (ref: string) => byRef.get(ref.trim().toLowerCase()) ?? null
  // Längere Kürzel zuerst, damit „StPO“ nicht als „StGB“ … und „GG“ nicht in „GVG“ greift.
  const byAbbr = [...book.laws].sort((a, b) => b.abbr.length - a.abbr.length)
  const resolve = (input: string) => {
    const raw = input.trim()
    if (!raw) return null
    const direct = find(raw)
    if (direct) return direct
    const law = byAbbr.find((candidate) => new RegExp(`(^|[^a-zäöü])${escape(candidate.abbr)}([^a-zäöü]|$)`, 'i').test(raw))
    if (!law) return null
    const rest = raw.replace(new RegExp(escape(law.abbr), 'i'), ' ')
    const number = /(\d+\s*[a-z]?)\b/i.exec(rest)?.[1]?.replace(/\s+/g, '').toLowerCase()
    if (!number) return null
    const wantsAt = /\bAT\b/.test(rest)
    const hits = law.norms.filter((norm) => {
      const own = /(\d+[a-z]?)$/i.exec(squash(norm.number))?.[1]
      return own === number && norm.number.startsWith('AT') === wantsAt
    })
    return hits.length === 1 ? toEntry(law, hits[0]) : null
  }
  return { source: book.source, syncedAt: book.syncedAt, origin, laws: book.laws, norms, find, resolve }
}

let current: LawCatalog = buildCatalog(fallback as Lawbook, 'fallback')
let loadedAt = 0
let failedAt = 0
let pending: Promise<LawCatalog> | null = null

function refresh() {
  pending ??= fetchLawbook()
    .then((book) => {
      current = buildCatalog(book, 'live')
      loadedAt = Date.now()
      return current
    })
    .catch((error: unknown) => {
      failedAt = Date.now()
      console.warn('[Gesetze] FJD-Seite nicht erreichbar, nutze letzten Stand:', error instanceof Error ? error.message : error)
      return current
    })
    .finally(() => { pending = null })
  return pending
}

/**
 * Aktuelles Gesetzbuch. Beim allerersten Aufruf wird live geladen (kurz
 * gewartet); später kommt sofort der Speicherstand und im Hintergrund wird
 * nachgeladen, sobald er älter als 30 Minuten ist.
 */
export async function getLaws(options: { fresh?: boolean } = {}): Promise<LawCatalog> {
  const now = Date.now()
  if (options.fresh) return refresh()
  if (!loadedAt) {
    // Nach einem Fehlschlag nicht jede Anfrage blockieren.
    if (now - failedAt < RETRY_MS) return current
    return refresh()
  }
  if (now - loadedAt > FRESH_MS && now - failedAt > RETRY_MS) void refresh()
  return current
}
