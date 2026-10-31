/**
 * Discord-Board „Agent der Woche“: goldene Karte für den Titelträger der
 * Vorwoche, danach Karten mit mehreren Agents der laufenden Woche. Reine
 * Darstellung – ohne Datenbank und Discord testbar.
 */
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import {
  DISCORD_COMPONENTS_V2_FLAG,
  actionRow,
  container,
  linkButton,
  markdownMeta,
  markdownPlain,
  separator,
  textDisplay,
  type DiscordMessageComponent,
} from '@/lib/discord/discord-components'
import {
  RATING_CATEGORIES,
  formatScore,
  placeIcon,
  scoreBar,
  weekKeyLabel,
  weekKeyShort,
  type RatingScores,
} from '@/lib/agents/agent-of-week'

export const GOLD_ACCENT = 0xf0b232

/** Agents je Ranking-Karte – wie im abgestimmten Entwurf. */
const AGENTS_PER_CARD = 3
/** Discord: höchstens 40 Komponenten und 4000 Zeichen Text je Nachricht; etwas Luft lassen. */
const MAX_COMPONENTS = 38
const MAX_TEXT = 3700

export type BoardAgent = RatingScores & {
  firstName: string
  lastName: string
  badgeNumber: string
  overall: number
  ratingCount: number
}

export type BoardInput = {
  week: string
  ranking: (BoardAgent & { place: number; qualified: boolean })[]
  raterCount: number
  winners: { week: string; agents: BoardAgent[] } | null
  url?: string
}

const name = (agent: BoardAgent) => markdownPlain(`${agent.firstName} ${agent.lastName}`)
const count = (value: number) => `${value} ${value === 1 ? 'Bewertung' : 'Bewertungen'}`

function winnerBlock(agent: BoardAgent) {
  return [
    `**${name(agent)}** · #${markdownPlain(displayBadgeNumber(agent.badgeNumber))} · Gesamt **${formatScore(agent.overall)} / 10**`,
    ...RATING_CATEGORIES.map(({ key, emoji, short }) => `\`${emoji}\` › ${short} ${scoreBar(agent[key])} **${formatScore(agent[key])}**`),
    markdownMeta([count(agent.ratingCount)]),
  ].join('\n')
}

function rankingBlock(agent: BoardInput['ranking'][number]) {
  const cell = (index: number) => {
    const { key, emoji } = RATING_CATEGORIES[index]
    return `\`${emoji}\` ${scoreBar(agent[key])} **${formatScore(agent[key])}**`
  }
  return [
    `**\`${placeIcon(agent.place)}\` ${name(agent)}** · Gesamt **${formatScore(agent.overall)}**`,
    `${cell(0)}   ${cell(1)}`,
    `${cell(2)}   ${cell(3)}`,
    markdownMeta([count(agent.ratingCount), agent.qualified ? null : 'zu wenige für den Titel']),
  ].join('\n')
}

type Card = { components: DiscordMessageComponent[]; text: number; size: number }
type CardSpec = { parts: string[]; accent?: number; extra?: DiscordMessageComponent[] }

function render({ parts, accent, extra = [] }: CardSpec): Card {
  const children = parts.flatMap((part, index) => index === 0 ? [textDisplay(part)] : [separator(), textDisplay(part)])
  const box = container([...children, ...extra])
  if (accent !== undefined) box.accent_color = accent
  // Container + Kinder; eine Action-Row zählt zusätzlich ihre Buttons.
  const size = 1 + children.length + extra.reduce((sum, item) => sum + 1 + ((item.components as unknown[] | undefined)?.length ?? 0), 0)
  return { components: [box], text: parts.reduce((sum, part) => sum + part.length, 0), size }
}

/** Nachrichten-Payloads in Reihenfolge; das Board verteilt sich bei Bedarf auf mehrere Nachrichten. */
export function agentOfWeekBoardMessages(input: BoardInput, stamp?: string) {
  const specs: CardSpec[] = [{
    accent: GOLD_ACCENT,
    parts: input.winners?.agents.length
      ? [`# \`🏆\` Agent der Woche\n${markdownMeta([weekKeyLabel(input.winners.week)])}`, ...input.winners.agents.map(winnerBlock)]
      : ['# `🏆` Agent der Woche\nNoch kein Titel vergeben – die erste Wertung endet am Sonntag um Mitternacht.'],
  }]

  const meta = markdownMeta(['Live-Stand', `${input.raterCount} Bewerter`, stamp ? `Stand ${stamp}` : null])
  if (!input.ranking.length) {
    specs.push({ parts: [`### \`📊\` › Ranking ${weekKeyShort(input.week)}\n${meta}`, `Für ${weekKeyShort(input.week)} liegen noch keine Bewertungen vor.`] })
  }
  for (let index = 0; index < input.ranking.length; index += AGENTS_PER_CARD) {
    const group = input.ranking.slice(index, index + AGENTS_PER_CARD)
    const from = index + 1
    const to = index + group.length
    const heading = `### \`📊\` › ${index === 0 ? `Ranking ${weekKeyShort(input.week)} · ` : ''}Plätze ${from}${to > from ? `–${to}` : ''}`
    specs.push({ parts: [index === 0 ? `${heading}\n${meta}` : heading, ...group.map(rankingBlock)] })
  }

  // Legende und Link hängen an der letzten Karte, damit sie immer unten stehen.
  const last = specs[specs.length - 1]
  last.parts.push(markdownMeta(RATING_CATEGORIES.map(({ emoji, label }) => `${emoji} ${label}`)))
  if (input.url) last.extra = [actionRow([linkButton('Zum Ranking', input.url)])]

  const messages: Card[][] = [[]]
  for (const item of specs.map(render)) {
    const current = messages[messages.length - 1]
    const size = current.reduce((sum, entry) => sum + entry.size, 0)
    const text = current.reduce((sum, entry) => sum + entry.text, 0)
    if (current.length && (size + item.size > MAX_COMPONENTS || text + item.text > MAX_TEXT)) messages.push([item])
    else current.push(item)
  }

  return messages.map((list) => ({
    flags: DISCORD_COMPONENTS_V2_FLAG,
    allowed_mentions: { parse: [] },
    components: list.flatMap((entry) => entry.components),
  }))
}

/** Stabiler Inhalt ohne Zeitstempel – das Board wird nur bei echten Änderungen neu geschrieben. */
export function agentOfWeekBoardFingerprint(input: BoardInput, channelId: string) {
  return JSON.stringify([channelId, agentOfWeekBoardMessages(input)])
}
