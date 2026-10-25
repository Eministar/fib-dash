import { escapeHtml } from './dom'

// Discord-Markdown → HTML für Ankündigungen und Versionshinweise. Alles, was
// nicht als Formatierung erkannt wird, landet escaped als Text – rohes HTML
// aus Discord kommt nie ins Fenster.

export interface Mentions {
  users: Record<string, string>
  roles: Record<string, { name: string; color: string | null }>
  channels: Record<string, string>
}

const NO_MENTIONS: Mentions = { users: {}, roles: {}, channels: {} }

const timestampFormats: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'medium' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
}
const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })

function relativeTime(date: Date) {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return relative.format(seconds, 'second')
}

function timestamp(seconds: string, style = 'f') {
  const date = new Date(Number(seconds) * 1000)
  const text = style === 'R' ? relativeTime(date) : new Intl.DateTimeFormat('de-DE', timestampFormats[style] ?? timestampFormats.f).format(date)
  return `<span class="md-mention md-time" title="${escapeHtml(date.toLocaleString('de-DE'))}">${escapeHtml(text)}</span>`
}

function link(url: string, label: string) {
  return `<a href="${escapeHtml(url)}" title="${escapeHtml(url)}">${label}</a>`
}

// URLs ohne Satzzeichen am Ende („siehe https://x.de.“).
const BARE_URL = /^https?:\/\/[^\s<]+[^\s<.,:;"')\]!?*_~|]/

type Rule = [RegExp, (match: RegExpExecArray, mentions: Mentions) => string]

const inlineRules: Rule[] = [
  [/^\\([^0-9A-Za-z\s])/, (m) => escapeHtml(m[1])],
  [/^(`+)([\s\S]*?[^`])\1(?!`)/, (m) => `<code>${escapeHtml(m[2].trim())}</code>`],
  [/^\|\|([\s\S]+?)\|\|/, (m, x) => `<span class="md-spoiler" role="button" tabindex="0" title="Spoiler anzeigen">${inline(m[1], x)}</span>`],
  [/^\*\*\*(?=\S)([\s\S]+?)\*\*\*(?!\*)/, (m, x) => `<strong><em>${inline(m[1], x)}</em></strong>`],
  [/^\*\*(?=\S)([\s\S]+?)\*\*(?!\*)/, (m, x) => `<strong>${inline(m[1], x)}</strong>`],
  [/^__([\s\S]+?)__(?!_)/, (m, x) => `<u>${inline(m[1], x)}</u>`],
  [/^\*(?=\S)([\s\S]*?\S)\*(?!\*)/, (m, x) => `<em>${inline(m[1], x)}</em>`],
  [/^_(?=\S)([\s\S]*?\S)_(?![_\w])/, (m, x) => `<em>${inline(m[1], x)}</em>`],
  [/^~~([\s\S]+?)~~/, (m, x) => `<s>${inline(m[1], x)}</s>`],
  [/^\[([^\]\n]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/, (m, x) => link(m[2], inline(m[1], x))],
  [/^<(https?:\/\/[^\s>]+)>/, (m) => link(m[1], escapeHtml(m[1]))],
  [BARE_URL, (m) => link(m[0], escapeHtml(m[0]))],
  [/^<@!?(\d+)>/, (m, x) => `<span class="md-mention">@${escapeHtml(x.users[m[1]] ?? 'Unbekannt')}</span>`],
  [/^<@&(\d+)>/, (m, x) => {
    const role = x.roles[m[1]]
    const style = role?.color ? ` style="--role:${escapeHtml(role.color)}"` : ''
    return `<span class="md-mention md-role"${style}>@${escapeHtml(role?.name ?? 'Rolle')}</span>`
  }],
  [/^<#(\d+)>/, (m, x) => `<span class="md-mention">#${escapeHtml(x.channels[m[1]] ?? 'Kanal')}</span>`],
  [/^@(everyone|here)\b/, (m) => `<span class="md-mention">@${m[1]}</span>`],
  [/^<(a?):(\w+):(\d+)>/, (m) =>
    `<img class="md-emoji" src="https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'webp'}?size=48" alt=":${escapeHtml(m[2])}:" title=":${escapeHtml(m[2])}:">`],
  [/^<t:(-?\d+)(?::([tTdDfFR]))?>/, (m) => timestamp(m[1], m[2])],
  [/^\n/, () => '<br>'],
]

// Bis zum nächsten Zeichen, mit dem eine Regel beginnen könnte, ist alles Text.
const PLAIN = /^[^\\`|*_~[<h@\n]+/

/** Zeilen-Formatierung (fett, Links, Erwähnungen …) – ohne Blöcke. */
export function inline(text: string, mentions: Mentions = NO_MENTIONS): string {
  let html = ''
  let rest = text
  outer: while (rest) {
    for (const [pattern, render] of inlineRules) {
      const match = pattern.exec(rest)
      if (match) {
        html += render(match, mentions)
        rest = rest.slice(match[0].length)
        continue outer
      }
    }
    const plain = PLAIN.exec(rest)?.[0] ?? rest[0]
    html += escapeHtml(plain)
    rest = rest.slice(plain.length)
  }
  return html
}

interface ListItem { indent: number; ordered: boolean; text: string }

function list(items: ListItem[], mentions: Mentions): string {
  let html = ''
  let i = 0
  while (i < items.length) {
    const { indent, ordered } = items[i]
    const tag = ordered ? 'ol' : 'ul'
    html += `<${tag}>`
    while (i < items.length && items[i].indent === indent && items[i].ordered === ordered) {
      html += `<li>${inline(items[i].text, mentions)}`
      i++
      // Tiefer eingerückte Einträge gehören als Unterliste zu diesem Punkt.
      const start = i
      while (i < items.length && items[i].indent > indent) i++
      if (i > start) html += list(items.slice(start, i), mentions)
      html += '</li>'
    }
    html += `</${tag}>`
  }
  return html
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/

/** Discord-Markdown als HTML (Überschriften, Listen, Zitate, Code, Zeilenformatierung). */
export function renderMarkdown(text: string, mentions: Mentions = NO_MENTIONS): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let html = ''
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) html += `<p>${inline(paragraph.join('\n'), mentions)}</p>`
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = /^\s*```(\w*)\s*(.*)$/.exec(line)
    if (fence) {
      flush()
      // Einzeiler wie ```code``` und Blöcke über mehrere Zeilen.
      const sameLine = /^\s*```([\s\S]*?)```\s*$/.exec(line)
      if (sameLine && line.trim().length > 6) {
        html += `<pre><code>${escapeHtml(sameLine[1])}</code></pre>`
        continue
      }
      const body: string[] = fence[2] ? [fence[2]] : []
      while (++i < lines.length && !/```\s*$/.test(lines[i])) body.push(lines[i])
      if (i < lines.length) body.push(lines[i].replace(/```\s*$/, ''))
      html += `<pre><code>${escapeHtml(body.join('\n').replace(/\n$/, ''))}</code></pre>`
      continue
    }

    if (line.startsWith('>>> ')) {
      flush()
      html += `<blockquote>${renderMarkdown([line.slice(4), ...lines.slice(i + 1)].join('\n'), mentions)}</blockquote>`
      break
    }

    if (/^> ?/.test(line) && line !== '>') {
      flush()
      const quoted: string[] = []
      while (i < lines.length && /^>( |$)/.test(lines[i])) quoted.push(lines[i++].replace(/^> ?/, ''))
      i--
      html += `<blockquote>${renderMarkdown(quoted.join('\n'), mentions)}</blockquote>`
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length + 1
      html += `<h${level} class="md-h${heading[1].length}">${inline(heading[2], mentions)}</h${level}>`
      continue
    }

    const subtext = /^-#\s+(.+)$/.exec(line)
    if (subtext) {
      flush()
      html += `<p class="md-subtext">${inline(subtext[1], mentions)}</p>`
      continue
    }

    if (LIST_ITEM.test(line)) {
      flush()
      const items: ListItem[] = []
      let match: RegExpExecArray | null
      while (i < lines.length && (match = LIST_ITEM.exec(lines[i]))) {
        items.push({ indent: match[1].length, ordered: /\d/.test(match[2]), text: match[3] })
        i++
      }
      i--
      html += list(items, mentions)
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }
    paragraph.push(line)
  }
  flush()
  return html
}

// Commit-Typen aus der Pipeline („feat: …“) als verständliche Markierung.
const changeKinds: Record<string, string> = { feat: 'Neu', fix: 'Behoben', perf: 'Schneller' }

/** Versionshinweise (Commit-Message des Builds) lesbar: Typ als Markierung, Rest als Markdown. */
export function renderReleaseNotes(notes: string | null | undefined): string {
  const text = (notes ?? '').trim()
  if (!text || text === 'Manueller Build') return '<p class="muted">Keine Beschreibung zu dieser Version.</p>'
  const [first, ...rest] = text.split('\n')
  const conventional = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(first)
  const kind = conventional ? (changeKinds[conventional[1].toLowerCase()] ?? 'Verbessert') : null
  const title = conventional ? conventional[2] : first
  const body = rest.join('\n').trim()
  return (
    `<p>${kind ? `<span class="change-kind" data-kind="${escapeHtml(kind)}">${kind}</span>` : ''}` +
    `${inline(title.charAt(0).toUpperCase() + title.slice(1))}</p>` +
    (body ? renderMarkdown(body) : '')
  )
}
