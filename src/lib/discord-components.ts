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
  return `# ${icon} ${title}${subject ? ` · ${subject}` : ''}`
}

export function markdownRows(rows: Array<{ label: string; value: string | null | undefined }>) {
  return rows
    .filter((row) => row.value)
    .map((row) => `- **${row.label}:** ${row.value}`)
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
