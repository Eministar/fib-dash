/**
 * Text der Kill-Clip-Nachricht im eigenen Clips-Channel. Reine Funktion, damit
 * sie testbar bleibt. Zeiten als Discord-Zeitstempel: Jeder sieht sie in seiner
 * eigenen Zeitzone, dazu „vor 5 Minuten“.
 */

import { iconLine } from './discord-components'

export type KillClipMessageInput = {
  agentName: string
  badge: string
  startedAt: Date
  endedAt?: Date | null
  kills: number
  /** Namen aus dem Kill-Feed, so wie sie im Spiel stehen. */
  victims?: string[]
  part?: number
  parts?: number
}

const MAX_VICTIMS = 10

/** Discord-Markdown in Spielernamen entschärfen („Max_Muster“, „||“ …). */
export function escapeDiscord(text: string) {
  return text.replace(/[\\*_~`|>#[\]()-]/g, (c) => `\\${c}`).replace(/@/g, '@​')
}

function unix(date: Date) {
  return Math.floor(date.getTime() / 1000)
}

export function killClipMessage(input: KillClipMessageInput) {
  const start = unix(input.startedAt)
  const end = input.endedAt ? unix(input.endedAt) : start
  const kills = `${input.kills} ${input.kills === 1 ? 'Kill' : 'Kills'}`
  const part = (input.parts ?? 1) > 1 ? ` · Teil ${input.part ?? 1}/${input.parts}` : ''
  const time = end - start >= 1 ? `<t:${start}:D> · <t:${start}:T> – <t:${end}:T>` : `<t:${start}:D> · <t:${start}:T>`

  const names = [...new Set((input.victims ?? []).map((name) => name.trim()).filter(Boolean))]
  const shown = names.slice(0, MAX_VICTIMS).map(escapeDiscord)
  const more = names.length > MAX_VICTIMS ? ` und ${names.length - MAX_VICTIMS} weitere` : ''

  return [
    `# 🎯 Kill-Clip · ${kills}${part}`,
    iconLine('👤', `**${escapeDiscord(input.agentName)}** (${escapeDiscord(input.badge)})`),
    iconLine('🕒', `${time} (<t:${start}:R>)`),
    shown.length ? iconLine('☠️', `${shown.join(' · ')}${more}`) : '',
    '-# Je 3 Sekunden vor und nach jedem Kill · automatisch von FIB Desktop',
  ]
    .filter(Boolean)
    .join('\n')
}
