/**
 * Liest das Gesetzbuch des Federal Justice Department
 * (https://fjd.kian-hahn.de/recht). Reine Funktionen ohne Netzwerk bis auf
 * `fetchLawbook`, damit Server (live) und Sync-Skript (Notfallkopie) dasselbe
 * Ergebnis bekommen.
 */

export const FJD_BASE = 'https://fjd.kian-hahn.de'

export type LawNorm = { id: string; number: string; title: string; section: string | null; text: string }
export type Law = { code: string; abbr: string; name: string; kind: string; group: string; status: string; url: string; norms: LawNorm[] }
export type Lawbook = { source: string; syncedAt: string; laws: Law[] }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (raw, name: string) => ENTITIES[name.toLowerCase()] ?? raw)
}
const plain = (html: string) => decode(html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** Normtext mit Absätzen und Aufzählungen als Zeilen. */
function normText(html: string) {
  const marked = html
    .replace(/<!--.*?-->/g, '')
    .replace(/<div[^>]*class="[^"]*recht-abs[^"]*"[^>]*>/g, '\n')
    .replace(/<li[^>]*>/g, '\n• ')
    .replace(/<\/p>|<br\s*\/?>/g, '\n')
  return decode(marked.replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim().replace(/^(\(\d+[a-z]?\))(?=\S)/, '$1 ').replace(/^• ((?:\d+|[a-z])[.)])(?=\S)/, '• $1 '))
    .filter(Boolean)
    .join('\n')
}

/** Übersicht: Gruppen und Gesetze in der Reihenfolge der Seite. */
export function parseLawIndex(html: string) {
  const laws: Omit<Law, 'url' | 'norms'>[] = []
  for (const section of html.split('<section>').slice(1)) {
    const group = plain(/<h2[^>]*>(.*?)<\/h2>/.exec(section)?.[1] ?? '')
    for (const item of section.matchAll(/<li[^>]*>(.*?)<\/li>/g)) {
      const link = /<a[^>]*href="\/recht\/([a-z0-9-]+)"[^>]*>(.*?)<\/a>/.exec(item[1])
      if (!link || link[1] === 'bekanntmachungen') continue
      const abbr = plain(/<span[^>]*>(.*?)<\/span>/.exec(link[2])?.[1] ?? '').replace(/^\(|\)$/g, '')
      const name = plain(link[2].replace(/<span.*<\/span>/, ''))
      const meta = plain(item[1].slice(item[1].indexOf('</a>') + 4))
      const [kind, status = ''] = meta.split(' · Stand ')
      laws.push({ code: link[1], name, abbr, kind: kind.trim(), group, status: status.trim() })
    }
  }
  return laws
}

/** Ein Gesetz: Abschnitte aus dem Inhaltsverzeichnis, Normen aus den Abschnitten. */
export function parseLawPage(html: string): LawNorm[] {
  const nav = /<nav aria-label="Inhaltsverzeichnis"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''
  const sectionOf = new Map<string, string | null>()
  // Das Inhaltsverzeichnis trennt Nummer („Art. 1“, „AT Nr. 1“) und Überschrift sauber.
  const headingOf = new Map<string, { number: string; title: string }>()
  let current: string | null = null
  for (const item of nav.matchAll(/<li([^>]*)>(.*?)<\/li>/g)) {
    const anchor = /href="#([^"]+)"/.exec(item[2])
    if (anchor) {
      sectionOf.set(anchor[1], current)
      const number = plain(/<span class="tabular-nums">(.*?)<\/span>/.exec(item[2])?.[1] ?? '')
      const title = plain(item[2].replace(/<span class="tabular-nums">.*?<\/span>/, ''))
      if (number) headingOf.set(anchor[1], { number, title: title === number ? '' : title })
    } else current = plain(item[2]) || current
  }
  const norms: LawNorm[] = []
  for (const part of html.split(/<section id="/).slice(1)) {
    if (!/^[^"]+" class="recht-norm/.test(part)) continue
    const id = part.slice(0, part.indexOf('"'))
    const heading = plain(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(part)?.[1] ?? '')
    const end = part.lastIndexOf('</section>')
    const body = part.slice(part.indexOf('</h3>') + 5, end > 0 ? end : undefined)
    const match = /^((?:§|Art\.|AT Nr\.|Nr\.)\s*[0-9]+[a-z]?)\s*(.*)$/i.exec(heading)
    const toc = headingOf.get(id)
    norms.push({
      id,
      number: toc?.number ?? (match ? match[1].replace(/\s+/g, ' ') : heading),
      title: toc ? toc.title : match ? match[2] : '',
      section: sectionOf.get(id) ?? null,
      text: normText(body),
    })
  }
  return norms
}

async function get(path: string, timeoutMs: number) {
  const response = await fetch(`${FJD_BASE}${path}`, {
    headers: { 'user-agent': 'fib-dashboard-lawbook' },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.text()
}

/** Das ganze Gesetzbuch live laden (Übersicht + alle Gesetze parallel). */
export async function fetchLawbook(timeoutMs = 15_000): Promise<Lawbook> {
  const index = parseLawIndex(await get('/recht/gesetze', timeoutMs))
  if (!index.length) throw new Error('Keine Gesetze in der Übersicht gefunden – hat sich die Seite geändert?')
  const laws = await Promise.all(index.map(async (entry) => ({
    ...entry,
    url: `${FJD_BASE}/recht/${entry.code}`,
    norms: parseLawPage(await get(`/recht/${entry.code}`, timeoutMs)),
  })))
  if (!laws.some((law) => law.norms.length)) throw new Error('Keine Normen gefunden – hat sich die Seite geändert?')
  return { source: `${FJD_BASE}/recht`, syncedAt: new Date().toISOString(), laws }
}
