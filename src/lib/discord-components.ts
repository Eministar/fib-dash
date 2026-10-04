export const DISCORD_COMPONENTS_V2_FLAG = 1 << 15

export type DiscordMessageComponent = Record<string, unknown>

export function textDisplay(content: string): DiscordMessageComponent {
  return {
    type: 10,
    content,
  }
}

export function separator(): DiscordMessageComponent {
  return {
    type: 14,
    divider: true,
    spacing: 1,
  }
}

export function actionRow(components: DiscordMessageComponent[]): DiscordMessageComponent {
  return {
    type: 1,
    components,
  }
}

/** Container bewusst ohne Akzentfarbe – alle Meldungen wirken gleich ruhig. */
export function container(components: DiscordMessageComponent[]): DiscordMessageComponent {
  return {
    type: 17,
    components,
  }
}

/** Link-Button (Style 5). Braucht keine Interaction — öffnet nur eine URL. */
export function linkButton(label: string, url: string): DiscordMessageComponent {
  return {
    type: 2,
    style: 5,
    label: label.slice(0, 80),
    url,
  }
}

export function componentMessage(
  components: DiscordMessageComponent[],
  options?: { allowedMentions?: Record<string, unknown> },
) {
  return {
    flags: DISCORD_COMPONENTS_V2_FLAG,
    allowed_mentions: options?.allowedMentions ?? { parse: [] },
    components: [container(components)],
  }
}

export function markdownHeader(icon: string, title: string, subject?: string | null) {
  return `## ${icon} ${title}${subject ? ` · ${subject}` : ''}`
}

const ROW_ICONS: Record<string, string> = {
  'Grund': '📝',
  'Einstufung': '📊',
  'Maßnahme': '⚖️',
  'Verstoß': '🚫',
  'Suspendiert bis': '⏳',
  'Erschwerend': '🔺',
  'Mildernd': '🔻',
  'Weitere Folge': '📌',
  'Vier-Augen-Bestätigung': '👥',
  'Status': '🔄',
  'Alter Rang': '⏮️',
  'Neuer Rang': '🎖️',
  'Zurückgesetzt von': '⏮️',
  'Zurückgesetzt auf': '🎖️',
  'DN-Wechsel': '🪪',
  'Dienstnummer': '🪪',
  'Vorgesehener Rang': '🎖️',
  'Vertrag': '📄',
  'Eintrittsdatum': '📅',
  'Eingereicht von': '✍️',
  'Erfasst von': '👤',
  'Von': '📅',
  'Bis': '🏁',
  'Zeitraum': '🗓️',
  'Art': '🏷️',
  'Typ': '🏷️',
  'Start': '🕒',
  'Ende': '🏁',
  'Ort': '📍',
  'Aktenzeichen': '🗂️',
  'Fallführung': '🕵️',
  'Ermittler': '🕵️',
  'Zugewiesen': '👥',
  'Priorität': '🚩',
  'Vorher': '⏮️',
  'Jetzt': '⏭️',
  'Größe': '💾',
  'Erfassung': '⚙️',
  'Im Dienst': '🟢',
  'Dienstzeit dieser Woche': '⏱️',
}

// Mentions, Rollen, Channels, Zeitstempel, Custom-Emojis, Links und vorhandener
// Inline-Code bleiben außerhalb der Backticks, sonst rendert Discord sie nicht.
const RICH_TOKEN = /(<(?:@[!&]?|#|t:|a?:\w+:)[^>]+>|https?:\/\/\S+|`[^`]+`)/
const VALUE_SEPARATOR = /(\s*(?:·|→|->)\s*)/

function codeSegment(text: string) {
  return text
    .split(VALUE_SEPARATOR)
    .map((piece, index) => {
      const value = piece.trim()
      if (index % 2 === 1 || !value) return piece
      const leading = piece.match(/^\s*/)?.[0] ?? ''
      const trailing = piece.match(/\s*$/)?.[0] ?? ''
      return `${leading}\`${value.replace(/`/g, "'")}\`${trailing}`
    })
    .join('')
}

/** Setzt Klartext eines Werts in Backticks; Mentions & Zeitstempel bleiben klickbar. */
export function markdownCode(value: string) {
  return value
    .replace(/\*\*/g, '')
    .split(RICH_TOKEN)
    .map((part, index) => (index % 2 === 1 ? part : codeSegment(part)))
    .join('')
}

const LONG_VALUE_CHARS = 90

export function markdownRows(rows: Array<{ label: string; value: string | null | undefined; icon?: string }>) {
  return rows
    .filter((row): row is { label: string; value: string; icon?: string } => Boolean(row.value?.trim()))
    .map((row) => {
      const icon = `\`${row.icon ?? ROW_ICONS[row.label] ?? '▫️'}\``
      const value = row.value.trim()
      // Längere Freitexte (Begründungen, Notizen) lesen sich als Zitat besser als als Code.
      if (value.includes('\n') || value.length > LONG_VALUE_CHARS) {
        return `${icon} **${row.label}**\n${markdownQuote(value.replace(/\*\*/g, ''))}`
      }
      return `${icon} **${row.label}:** ${markdownCode(value)}`
    })
    .join('\n')
}

export function markdownQuote(value: string | null | undefined) {
  if (!value?.trim()) return ''
  return value.trim().split('\n').map((line) => `> ${line}`).join('\n')
}

export function markdownMeta(parts: Array<string | null | undefined>) {
  return `-# ${parts.filter(Boolean).join(' · ')}`
}

export function markdownTextDisplays(parts: Array<string | null | undefined>, maxChars = 3900) {
  const chunks: string[] = []
  let current = ''

  for (const part of parts.map((value) => value?.trim()).filter((value): value is string => Boolean(value))) {
    const candidate = current ? `${current}\n\n${part}` : part
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    current = part.length <= maxChars ? part : `${part.slice(0, maxChars - 1)}…`
  }

  if (current) chunks.push(current)
  return chunks.flatMap((content, index) => index === 0 ? [textDisplay(content)] : [separator(), textDisplay(content)])
}
