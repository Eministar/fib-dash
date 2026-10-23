/**
 * Lagerlogs aus dem Discord-Webhook „Fraklager“. Reine Logik ohne Datenbank:
 * Embeds lesen, Namen abgleichen, Waffen erkennen, Auffälligkeiten bewerten.
 *
 * Format (ein Embed je Vorgang):
 *   Titel  „Eingelagert“ / „Ausgelagert“
 *   Text   „Niklas Dior hat 1x WEAPON_PISTOL50 in Lager eingelagert.“
 *          „Niklas Dior hat 2x kokain1 aus Lager ausgelagert.“
 */

export type StorageDirection = 'IN' | 'OUT'

export type ParsedStorageEntry = {
  direction: StorageDirection
  actorName: string
  quantity: number
  item: string
  storage: string
  rawText: string
}

type EmbedLike = { title?: string | null; description?: string | null }

const OUT_WORDS = /(ausgelagert|entnommen|herausgenommen|rausgenommen|genommen|abgehoben)/i
const IN_WORDS = /(eingelagert|hinterlegt|abgelegt|eingezahlt)/i

// „<Name> hat <n>x <Item> in|aus|im|vom <Lager> <verb>.“ – Name darf Leerzeichen enthalten.
// Gruppen: 1 Name, 2 Menge, 3 Gegenstand, 4 Lager, 5 Verb.
const LINE = /^(.+?)\s+hat\s+(\d+)\s*[x×]\s*(\S+)\s+(?:in|aus|im|vom|von|ins)\s+(?:dem\s+|das\s+|den\s+)?(.+?)\s+([A-Za-zÄÖÜäöüß]+)\.?\s*$/

function directionOf(...texts: (string | null | undefined)[]): StorageDirection | null {
  const joined = texts.filter(Boolean).join(' ')
  if (OUT_WORDS.test(joined)) return 'OUT'
  if (IN_WORDS.test(joined)) return 'IN'
  return null
}

/** Ein Embed lesen; `null`, wenn es kein Lagervorgang ist. */
export function parseStorageEmbed(embed: EmbedLike): ParsedStorageEntry | null {
  const text = (embed.description ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  const match = LINE.exec(text)
  if (!match) return null
  const [, name, qty, item, storage, verb] = match
  const direction = directionOf(verb) ?? directionOf(embed.title)
  if (!direction) return null
  const quantity = Number.parseInt(qty, 10)
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) return null
  return {
    direction,
    actorName: name.trim().slice(0, 120),
    quantity,
    item: item.trim().slice(0, 120),
    storage: storage.trim().slice(0, 120),
    rawText: text.slice(0, 2000),
  }
}

/** Für den Abgleich: Kleinschreibung, ohne Akzente, einfache Leerzeichen. */
export function normalizePersonName(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

type NamedAgent = { id: string; firstName: string; lastName: string; status: string }
type AgentTokens = { id: string; first: string[]; last: string[] }

/** Höchstens `max` Tippfehler auseinander? (Levenshtein, früh abgebrochen) */
function withinEdits(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    if (Math.min(...current) > max) return false
    previous = current
  }
  return previous[b.length] <= max
}

/** Steht die Wortfolge `needle` zusammenhängend in `tokens`? Gibt die Startposition zurück. */
function findSequence(tokens: string[], needle: string[], same: (a: string, b: string) => boolean) {
  if (!needle.length) return -1
  for (let start = 0; start + needle.length <= tokens.length; start++) {
    if (needle.every((part, offset) => same(tokens[start + offset], part))) return start
  }
  return -1
}

/** Passt der Vorname aus dem Log (falls vorhanden) zum Agent? „N.“, „Nik“ und „Niklas“ passen zu „Niklas“. */
function firstNameFits(logFirst: string[], agentFirst: string[]) {
  if (!logFirst.length || !agentFirst.length) return true
  const a = logFirst[0]
  const b = agentFirst[0]
  return a.startsWith(b) || b.startsWith(a) || withinEdits(a, b, 1)
}

/**
 * Nur eindeutige Treffer zählen – lieber nicht zuordnen als falsch zuordnen.
 * `undefined` = kein Treffer, `null` = mehrdeutig.
 */
function matchIn(agents: AgentTokens[], tokens: string[]): string | null | undefined {
  const key = tokens.join(' ')
  const exact = agents.filter((agent) => [...agent.first, ...agent.last].join(' ') === key || [...agent.last, ...agent.first].join(' ') === key)
  if (exact.length === 1) return exact[0].id
  if (exact.length > 1) return null

  // Über den Nachnamen. Ins Lager kommen nur FIB-Leute, ein eindeutiger
  // Nachname reicht also; der Vorname entscheidet nur bei gleichen Nachnamen.
  const byLastName = (same: (a: string, b: string) => boolean) => {
    const candidates = agents
      .map((agent) => ({ agent, at: findSequence(tokens, agent.last, same) }))
      .filter((candidate) => candidate.at !== -1)
    if (candidates.length <= 1) return candidates.map((candidate) => candidate.agent)
    return candidates
      .filter(({ agent, at }) => firstNameFits([...tokens.slice(0, at), ...tokens.slice(at + agent.last.length)], agent.first))
      .map((candidate) => candidate.agent)
  }
  const sameLast = byLastName((a, b) => a === b)
  if (sameLast.length === 1) return sameLast[0].id
  if (sameLast.length > 1) return null

  // Ein Tippfehler im Nachnamen, nur bei längeren Namen.
  const typoLast = byLastName((a, b) => a === b || (b.length >= 5 && withinEdits(a, b, 1)))
  if (typoLast.length > 1) return null
  return typoLast[0]?.id
}

/**
 * Agent-ID zu einem Namen aus dem Log. Erst exakt (auch „Nachname Vorname“),
 * dann über den Nachnamen, dann mit einem Tippfehler im Nachnamen. Aktive
 * Agents haben Vorrang; mehrdeutige Treffer werden nicht zugeordnet.
 */
export function buildAgentNameMatcher(agents: NamedAgent[]) {
  const tokenize = (agent: NamedAgent): AgentTokens => ({
    id: agent.id,
    first: normalizePersonName(agent.firstName).split(' ').filter(Boolean),
    last: normalizePersonName(agent.lastName).split(' ').filter(Boolean),
  })
  const active = agents.filter((agent) => agent.status !== 'TERMINATED').map(tokenize).filter((agent) => agent.last.length)
  const former = agents.filter((agent) => agent.status === 'TERMINATED').map(tokenize).filter((agent) => agent.last.length)
  return (name: string) => {
    const tokens = normalizePersonName(name).split(' ').filter(Boolean)
    if (!tokens.length) return null
    // Mehrdeutig unter den Aktiven heißt: nicht auf Ausgeschiedene ausweichen.
    const hit = matchIn(active, tokens)
    return hit !== undefined ? hit : matchIn(former, tokens) ?? null
  }
}

const DEFAULT_WEAPON_HINTS = ['weapon_', 'waffe', 'gun', 'rifle', 'pistol', 'smg', 'shotgun', 'carbine', 'sniper', 'knife', 'switchblade', 'machete', 'baseballbat', 'grenade', 'molotov', 'taser', 'stungun']

/** Waffe? `WEAPON_…` immer, sonst typische Namen und die eigene Liste aus den Einstellungen. */
export function isWeaponItem(item: string, extra: readonly string[] = []) {
  const lower = item.toLowerCase()
  if (lower.startsWith('weapon_')) return true
  return [...DEFAULT_WEAPON_HINTS, ...extra.map((hint) => hint.toLowerCase().trim()).filter(Boolean)].some((hint) => lower.includes(hint))
}

/** „WEAPON_PISTOL50“ → „Pistol50“, „kokain1“ → „Kokain1“. */
export function itemLabel(item: string) {
  const clean = item.replace(/^weapon_/i, '').replace(/_/g, ' ').trim()
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\B\w+/g, (rest) => rest.toLowerCase())
}

const SLUG_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Kurzer, gut vorlesbarer Schlüssel ohne verwechselbare Zeichen (0/O, 1/I/L). */
export function storageSlug(prefix: 'LAG' | 'WARN', random: () => number = Math.random) {
  let body = ''
  for (let i = 0; i < 6; i++) body += SLUG_ALPHABET[Math.floor(random() * SLUG_ALPHABET.length)]
  return `${prefix}-${body}`
}

/** Discord-Snowflake für einen Zeitpunkt – Startpunkt für den Abruf älterer Nachrichten. */
export function snowflakeAt(date: Date) {
  return ((BigInt(date.getTime()) - BigInt(1420070400000)) << BigInt(22)).toString()
}

export type AlertSettings = {
  weaponThreshold: number
  itemThreshold: number
  windowMinutes: number
  cooldownMinutes: number
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  weaponThreshold: 5,
  itemThreshold: 30,
  windowMinutes: 15,
  cooldownMinutes: 30,
}

export type WindowEntry = { slug: string; quantity: number; isWeapon: boolean; occurredAt: Date }

/**
 * Entnahmen eines Agents im Zeitfenster vor `until` bewerten. `null` = unauffällig.
 * Gezählt wird die Menge, nicht die Zahl der Einträge („3x Pistole“ zählt 3).
 */
export function evaluateWithdrawals(entries: readonly WindowEntry[], until: Date, settings: AlertSettings) {
  const from = new Date(until.getTime() - settings.windowMinutes * 60_000)
  const inWindow = entries.filter((entry) => entry.occurredAt > from && entry.occurredAt <= until)
  const weaponCount = inWindow.filter((entry) => entry.isWeapon).reduce((sum, entry) => sum + entry.quantity, 0)
  const itemCount = inWindow.reduce((sum, entry) => sum + entry.quantity, 0)
  const weapons = settings.weaponThreshold > 0 && weaponCount >= settings.weaponThreshold
  const items = settings.itemThreshold > 0 && itemCount >= settings.itemThreshold
  if (!weapons && !items) return null
  return {
    weaponCount,
    itemCount,
    reasons: [weapons ? 'weapons' : null, items ? 'items' : null].filter(Boolean) as ('weapons' | 'items')[],
    windowStart: inWindow.reduce((min, entry) => (entry.occurredAt < min ? entry.occurredAt : min), until),
    windowEnd: until,
    slugs: [...inWindow].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).map((entry) => entry.slug),
  }
}

export type AlertMessageInput = {
  userId: string
  actorName: string
  agentLabel: string | null
  weaponCount: number
  itemCount: number
  windowMinutes: number
  reasons: ('weapons' | 'items')[]
  entries: Array<{ slug: string; item: string; quantity: number; isWeapon: boolean; occurredAt: Date }>
  /** Basis-URL des Dashboards; ohne sie entfallen die Links. */
  baseUrl?: string
  alertSlug: string
}

/** Warnung mit Ping genau dieser einen Person (keine anderen Mentions). */
export function storageAlertMessage(input: AlertMessageInput) {
  const link = (path: string) => (input.baseUrl ? `${input.baseUrl}${path}` : null)
  const who = input.agentLabel ?? `${input.actorName} (keinem Agent zugeordnet)`
  const reasons = input.reasons.map((reason) => (reason === 'weapons' ? `**${input.weaponCount} Waffen**` : `**${input.itemCount} Gegenstände**`)).join(' und ')
  const lines = input.entries.slice(0, 15).map((entry) => {
    const url = link(`/leadership/storage/${entry.slug}`)
    const name = `${entry.quantity}× ${itemLabel(entry.item)}${entry.isWeapon ? ' 🔫' : ''}`
    return `• <t:${Math.floor(entry.occurredAt.getTime() / 1000)}:t> ${url ? `[${name}](${url})` : name} · \`${entry.slug}\``
  })
  if (input.entries.length > 15) lines.push(`• … und ${input.entries.length - 15} weitere`)
  const overview = link(`/leadership/storage?alert=${encodeURIComponent(input.alertSlug)}`)

  // Komponenten-Nachrichten haben kein `content`; der Ping steht im ersten Textblock.
  return {
    allowed_mentions: { parse: [], users: [input.userId] },
    flags: 1 << 15,
    components: [{
      type: 17,
      accent_color: 0xff453a,
      components: [
        { type: 10, content: `<@${input.userId}>\n## ⚠️ Auffällige Lagerentnahme\n**${who}** hat in ${input.windowMinutes} Minuten ${reasons} entnommen.` },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: lines.join('\n') },
        { type: 10, content: `-# Warnung \`${input.alertSlug}\`` },
        ...(overview ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Lagerlogs öffnen', url: overview }] }] : []),
      ],
    }],
  }
}

/** Ganze Zahl aus einer Einstellung, sonst der Standard. */
export function settingNumber(value: string | null | undefined, fallback: number, max = 100_000) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback
}
