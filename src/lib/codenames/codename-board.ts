import { displayBadgeNumber } from '@/lib/agents/badge-number'

const NAME_COLUMN_MAX = 32
const BADGE_COLUMN_MAX = 12

/**
 * Pure rendering: never truncate the roster, even with unusually long names.
 * Spalten werden über alle Seiten gleich breit aufgefüllt, damit sie im
 * Codeblock untereinanderstehen; der Agent steht hinten, weil nur dort ein
 * Umbruch auf schmalen Bildschirmen nicht stört.
 */
export function codenameBoardPages(rows: { name: string; currentAgent: { firstName: string; lastName: string; badgeNumber: string } | null }[], prefix: string) {
  const clean = (text: string) => text.replace(/[`\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  const entries = rows.flatMap(row => row.currentAgent ? [{
    label: clean([prefix, row.name].filter(Boolean).join(' ')),
    badge: clean(displayBadgeNumber(row.currentAgent.badgeNumber)),
    agent: `${clean(row.currentAgent.lastName)}, ${clean(row.currentAgent.firstName)}`,
  }] : [])
  if (!entries.length) return ['Derzeit sind keine Decknamen vergeben.']
  const nameWidth = Math.min(NAME_COLUMN_MAX, Math.max('Deckname'.length, ...entries.map(e => e.label.length)))
  const badgeWidth = Math.min(BADGE_COLUMN_MAX, Math.max('DN'.length, ...entries.map(e => e.badge.length)))
  const line = (label: string, badge: string, agent: string) => `${label.padEnd(nameWidth)} | ${badge.padEnd(badgeWidth)} | ${agent}`
  const header = `${line('Deckname', 'DN', 'Agent')}\n${'-'.repeat(nameWidth + badgeWidth + 12)}`
  const pages: string[][] = [[]]
  for (const entry of entries) {
    const text = line(entry.label, entry.badge, entry.agent)
    let page = pages[pages.length - 1]
    if (page.length && (page.length >= 30 || header.length + page.join('\n').length + text.length + 1 > 3500)) {
      page = []
      pages.push(page)
    }
    page.push(text)
  }
  return pages.map(page => '```\n' + header + '\n' + page.join('\n') + '\n```')
}

/** Stabiler Inhalt ohne Zeitstempel – ändert sich nur, wenn sich die Belegung ändert. */
export function codenameBoardFingerprint(pages: string[], channelId: string) {
  return JSON.stringify([channelId, pages])
}

/** Persist each new/deleted ID immediately so retries resume after partial failure. */
export async function reconcileCodenameMessages<T>(input: {
  ids: string[]
  pages: T[]
  patch: (id: string, page: T) => Promise<void>
  post: (page: T) => Promise<string>
  remove: (id: string) => Promise<void>
  save: (ids: string[]) => Promise<void>
  isMissing: (cause: unknown) => boolean
}) {
  const ids = [...input.ids]
  for (let index = 0; index < input.pages.length; index++) {
    if (ids[index]) {
      try { await input.patch(ids[index], input.pages[index]); continue }
      catch (cause) { if (!input.isMissing(cause)) throw cause }
    }
    ids[index] = await input.post(input.pages[index])
    await input.save([...ids])
  }
  while (ids.length > input.pages.length) {
    try { await input.remove(ids[ids.length - 1]) }
    catch (cause) { if (!input.isMissing(cause)) throw cause }
    ids.pop()
    await input.save([...ids])
  }
  return ids
}
