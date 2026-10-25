/**
 * Bringt bereits gesendete Bot-Nachrichten auf den aktuellen Discord-Style.
 * Reine Textlogik ohne Netzwerk, damit sie testbar bleibt; das Durchgehen der
 * Channels steckt in `discord-restyle-server.ts`.
 *
 * Die Umwandlung ist idempotent: Eine Zeile im neuen Format wird nicht noch
 * einmal verändert. Ändert sich der Style erneut, `DISCORD_STYLE_VERSION`
 * erhöhen und die Regeln hier ergänzen – beim nächsten Start werden dann alle
 * gesendeten Nachrichten nachgezogen.
 */
import { iconLine, markdownTitle, rowIcon } from './discord-components'

/** v2: großer Titel (`` # `emoji` Titel ``), Zeilen als `` `emoji` › Text ``. */
export const DISCORD_STYLE_VERSION = 2

const EMOJI = String.raw`(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})️?(?:‍\p{Extended_Pictographic}️?)*`
const LEADING_EMOJI = new RegExp(`^(${EMOJI}) +(?!›)(\\S.*)$`, 'u')
const CODE_EMOJI_WITHOUT_ARROW = new RegExp(`^\`(${EMOJI})\` +(?!›)(\\S.*)$`, 'u')
// Mehrere Angaben in einer Zeile: Aktenkarte (Ideographic Space) und Listen („  ·  “).
const SEGMENT_SEPARATOR = /(　|\s{2}·\s{2})/
const NUMBER_PREFIX = /^(`\d+`\s+)/
// Agent-Zeile unter dem Titel einer Personalmeldung: Person · `DN` · Rang.
const AGENT_LINE = /^(<@!?\d+>|\*\*.+?\*\*) · (`[^`]+`)(?: · (.+))?$/
// Zeilen der Verlaufsmeldungen im Ermittlungsforum: **Label** Wert.
const FORUM_ROW = /^\*\*([^*:]+)\*\* (\S.*)$/
const DOSSIER_OVERVIEW_LINE = /^(?!`)(.+ · \d+ Akten)$/

const SECTION_ICONS: Record<string, string> = {
  '**Laufende Ermittlungen**': '🔎',
  '**Abgeschlossen**': '📕',
  '**Meiste Dienstzeit**': '🏆',
  '**Änderungen**': '🛠️',
}

function restyleSegment(segment: string) {
  const leading = segment.match(/^\s*/)?.[0] ?? ''
  const trailing = segment.match(/\s*$/)?.[0] ?? ''
  const core = segment.trim()
  const match = core.match(LEADING_EMOJI)
  return match ? `${leading}${iconLine(match[1], match[2])}${trailing}` : segment
}

function restyleBodyLine(line: string) {
  const quote = line.startsWith('> ') ? '> ' : ''
  let rest = line.slice(quote.length)
  const number = rest.match(NUMBER_PREFIX)?.[1] ?? ''
  rest = rest.slice(number.length)

  if (SECTION_ICONS[rest]) return `${quote}${number}${iconLine(SECTION_ICONS[rest], rest)}`

  const segments = rest.split(SEGMENT_SEPARATOR)
  const restyled = segments.map((segment, index) => (index % 2 === 1 ? segment : restyleSegment(segment))).join('')
  return `${quote}${number}${restyled}`
}

function restyleSubheading(title: string) {
  const coded = title.match(CODE_EMOJI_WITHOUT_ARROW)
  if (coded) return `### ${iconLine(coded[1], coded[2])}`
  const plain = title.match(LEADING_EMOJI)
  return plain ? `### ${iconLine(plain[1], plain[2])}` : `### ${title}`
}

function restyleAgentLine(line: string) {
  const match = line.match(AGENT_LINE)
  if (!match) return null
  return [iconLine('👤', match[1]), iconLine('🪪', match[2]), match[3] ? iconLine('🎖️', match[3]) : null]
    .filter(Boolean)
    .join(' · ')
}

/** Wandelt den Text einer Nachricht (Text-Display oder `content`) in den aktuellen Style um. */
export function restyleDiscordText(text: string) {
  const lines = text.split('\n')
  const hasSubheading = lines.some((line) => line.startsWith('### '))
  let inCode = false
  let previous = ''

  const result = lines.map((line) => {
    const before = previous
    previous = line
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      return line
    }
    if (inCode) return line

    const title = line.match(/^#{1,2} (?!#)(.*)$/)
    if (title) {
      const emoji = title[1].match(LEADING_EMOJI)
      return emoji ? markdownTitle(emoji[1], emoji[2]) : `# ${title[1]}`
    }
    if (line.startsWith('### ')) return restyleSubheading(line.slice(4))
    if (line.startsWith('#') || line.startsWith('-#')) return line

    if (/^#{1,2} /.test(before)) {
      const agentLine = restyleAgentLine(line)
      if (agentLine) return agentLine
    }

    if (hasSubheading) {
      const row = line.match(FORUM_ROW)
      if (row) return iconLine(rowIcon(row[1]), `**${row[1]}:** ${row[2]}`)
    }

    const overview = line.match(DOSSIER_OVERVIEW_LINE)
    if (overview && /^(<#\d+>|[^\s`>*-])/.test(line) && !LEADING_EMOJI.test(line)) return iconLine('📁', overview[1])

    return restyleBodyLine(line)
  })

  return result.join('\n')
}

type ComponentNode = Record<string, unknown>

/**
 * Wendet `restyleDiscordText` auf alle Text-Displays (Typ 10) eines
 * Component-Baums an. Gibt `null` zurück, wenn sich nichts ändert.
 */
export function restyleComponents(components: unknown[]): unknown[] | null {
  let changed = false
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit)
    if (!node || typeof node !== 'object') return node
    const source = node as ComponentNode
    const copy: ComponentNode = {}
    for (const [key, value] of Object.entries(source)) copy[key] = visit(value)
    if (source.type === 10 && typeof source.content === 'string') {
      const content = restyleDiscordText(source.content)
      if (content !== source.content) {
        copy.content = content
        changed = true
      }
    }
    return copy
  }
  const result = components.map(visit)
  return changed ? result : null
}
