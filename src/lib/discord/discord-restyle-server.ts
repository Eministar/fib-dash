/**
 * Zieht bereits gesendete Bot-Nachrichten auf den aktuellen Style nach
 * (siehe `discord-restyle.ts`). Läuft einmal pro Style-Version beim Start:
 * alle Channels aus der Discord-Konfiguration, die Clip-Channels der Agents,
 * die Channels der Ermittlungsgruppen, die Beiträge im Ermittlungsforum und
 * die Meldungen des Monitor-Webhooks. Direktnachrichten lassen sich nicht
 * auflisten und bleiben, wie sie sind.
 */
import { prisma } from '../prisma'
import {
  DiscordApiError,
  discordFetch,
  getDiscordConfig,
  syncDiscordAbsenceStatusMessage,
  syncDiscordCodenameBoard,
  syncDiscordAgentOfWeekBoard,
  syncDiscordDutyStatusMessage,
} from './discord-integration'
import { DISCORD_STYLE_VERSION, restyleComponents, restyleDiscordText } from './discord-restyle'

const STYLE_VERSION_KEY = 'discord.styleVersion'
const START_DELAY_MS = 60_000
const COMPONENTS_V2_FLAG = 1 << 15
const FORUM_CHANNEL = 15
const THREAD_ARCHIVED = 50083

type DiscordMessage = {
  id: string
  author?: { id: string }
  webhook_id?: string
  flags?: number
  content?: string
  components?: unknown[]
  attachments?: { id: string; filename: string; url: string }[]
}

type DiscordThread = { id: string; parent_id?: string | null; thread_metadata?: { archived?: boolean; archive_timestamp?: string } }

type Edit = { messageId: string; body: Record<string, unknown> }

type Stats = { channels: number; edited: number; skipped: number; failed: number }

const runtime = globalThis as typeof globalThis & { discordRestyleStarted?: boolean }

/** Medien in Antworten tragen CDN-Links; beim Bearbeiten muss wieder auf den Anhang verwiesen werden. */
function editableMedia(node: unknown, attachments: DiscordMessage['attachments'] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => editableMedia(item, attachments))
  if (!node || typeof node !== 'object') return node
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((key === 'media' || key === 'file') && value && typeof value === 'object') {
      const media = value as { url?: string; attachment_id?: string }
      const attachment = attachments.find((item) => item.id === media.attachment_id
        || (media.url && item.url.split('?')[0] === media.url.split('?')[0]))
      copy[key] = { url: attachment ? `attachment://${attachment.filename}` : media.url }
    } else {
      copy[key] = editableMedia(value, attachments)
    }
  }
  return copy
}

/** Neuer Inhalt einer Nachricht im aktuellen Style, `null` wenn sie schon passt. */
function restyledBody(message: DiscordMessage): Record<string, unknown> | null {
  if ((message.flags ?? 0) & COMPONENTS_V2_FLAG) {
    const components = restyleComponents(message.components ?? [])
    return components ? { components: editableMedia(components, message.attachments), allowed_mentions: { parse: [] } } : null
  }
  if (!message.content) return null
  const content = restyleDiscordText(message.content)
  return content !== message.content ? { content, allowed_mentions: { parse: [] } } : null
}

async function channelMessages(channelId: string) {
  const messages: DiscordMessage[] = []
  let before = ''
  for (;;) {
    const page = await discordFetch<DiscordMessage[]>(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`)
    messages.push(...page)
    if (page.length < 100) return messages
    before = page[page.length - 1].id
  }
}

function isUnreachable(error: unknown) {
  return error instanceof DiscordApiError && (error.status === 403 || error.status === 404)
}

async function applyEdits(channelId: string, edits: Edit[], stats: Stats, thread?: DiscordThread) {
  if (edits.length === 0) return
  const archived = Boolean(thread?.thread_metadata?.archived)
  if (archived) await discordFetch(`/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) })
  try {
    for (const edit of edits) {
      try {
        await discordFetch(`/channels/${channelId}/messages/${edit.messageId}`, { method: 'PATCH', body: JSON.stringify(edit.body) })
        stats.edited++
      } catch (error) {
        if (isUnreachable(error) || (error instanceof DiscordApiError && error.code === THREAD_ARCHIVED)) stats.skipped++
        else {
          stats.failed++
          console.error(`[DiscordRestyle] Nachricht ${edit.messageId} in ${channelId} nicht aktualisiert:`, error)
        }
      }
    }
  } finally {
    if (archived) await discordFetch(`/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }).catch(() => undefined)
  }
}

async function restyleChannel(channelId: string, botId: string, stats: Stats, thread?: DiscordThread) {
  try {
    const messages = await channelMessages(channelId)
    stats.channels++
    const edits = messages
      .filter((message) => message.author?.id === botId && !message.webhook_id)
      .map((message) => ({ messageId: message.id, body: restyledBody(message) }))
      .filter((edit): edit is Edit => edit.body !== null)
    await applyEdits(channelId, edits, stats, thread)
  } catch (error) {
    if (isUnreachable(error)) return
    stats.failed++
    console.error(`[DiscordRestyle] Channel ${channelId} fehlgeschlagen:`, error)
  }
}

async function forumThreads(guildId: string, forumId: string) {
  const active = await discordFetch<{ threads: DiscordThread[] }>(`/guilds/${guildId}/threads/active`)
  const threads = active.threads.filter((thread) => thread.parent_id === forumId)
  let before = ''
  for (;;) {
    const page = await discordFetch<{ threads: DiscordThread[]; has_more?: boolean }>(
      `/channels/${forumId}/threads/archived/public?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`,
    )
    threads.push(...page.threads)
    const last = page.threads[page.threads.length - 1]?.thread_metadata?.archive_timestamp
    if (!page.has_more || !last) return threads
    before = last
  }
}

/** Meldungen des Monitor-Webhooks gehören dem Webhook und lassen sich nur über ihn bearbeiten. */
async function restyleWebhookMessages(botId: string, stats: Stats) {
  const raw = process.env.DISCORD_WEBHOOK_URL?.trim() || process.env.FIB_DISCORD_WEBHOOK_URL?.trim() || ''
  if (!raw) return
  const base = raw.split('?')[0].replace(/\/$/, '')
  const webhook = await fetch(base).then((res) => res.ok ? res.json() as Promise<{ id: string; channel_id: string }> : null).catch(() => null)
  if (!webhook) return
  try {
    const messages = await channelMessages(webhook.channel_id)
    for (const message of messages) {
      if (message.webhook_id !== webhook.id || message.author?.id === botId) continue
      const body = restyledBody(message)
      if (!body) continue
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`${base}/messages/${message.id}?with_components=true`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.status === 429) {
          const wait = await res.json().then((data: { retry_after?: number }) => data.retry_after ?? 2).catch(() => 2)
          await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 250))
          continue
        }
        if (res.ok) stats.edited++
        else stats.skipped++
        break
      }
    }
  } catch (error) {
    if (!isUnreachable(error)) {
      stats.failed++
      console.error('[DiscordRestyle] Monitor-Meldungen fehlgeschlagen:', error)
    }
  }
}

export async function restyleSentDiscordMessages() {
  const config = await getDiscordConfig()
  const stats: Stats = { channels: 0, edited: 0, skipped: 0, failed: 0 }
  if (!config.guildId) return stats

  const [bot, guildChannels, groups] = await Promise.all([
    discordFetch<{ id: string }>('/users/@me'),
    discordFetch<{ id: string; type: number; parent_id?: string | null }[]>(`/guilds/${config.guildId}/channels`),
    prisma.leadershipGroup.findMany({ where: { channelId: { not: null } }, select: { channelId: true } }),
  ])

  const channelIds = new Set<string>()
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith('ChannelId') && typeof value === 'string' && /^\d{17,22}$/.test(value)) channelIds.add(value)
  }
  for (const group of groups) if (group.channelId) channelIds.add(group.channelId)
  if (config.clipsCategoryId) {
    for (const channel of guildChannels) if (channel.type === 0 && channel.parent_id === config.clipsCategoryId) channelIds.add(channel.id)
  }

  const typeById = new Map(guildChannels.map((channel) => [channel.id, channel.type]))
  for (const channelId of channelIds) {
    if (typeById.get(channelId) !== FORUM_CHANNEL) {
      await restyleChannel(channelId, bot.id, stats)
      continue
    }
    try {
      for (const thread of await forumThreads(config.guildId, channelId)) await restyleChannel(thread.id, bot.id, stats, thread)
    } catch (error) {
      if (!isUnreachable(error)) {
        stats.failed++
        console.error(`[DiscordRestyle] Forum ${channelId} fehlgeschlagen:`, error)
      }
    }
  }
  await restyleWebhookMessages(bot.id, stats)

  // Dauerhafte Nachrichten direkt aus den aktuellen Daten neu schreiben.
  await Promise.allSettled([
    syncDiscordDutyStatusMessage(),
    syncDiscordAbsenceStatusMessage(),
    syncDiscordCodenameBoard({ force: true }),
    syncDiscordAgentOfWeekBoard({ force: true }),
    prisma.leadershipGroup.updateMany({ data: { nextSyncAt: new Date() } }),
  ])
  return stats
}

/** Startet das Nachziehen einmal pro Style-Version; bei Fehlern erneut beim nächsten Start. */
export function ensureDiscordRestyle() {
  if (runtime.discordRestyleStarted) return
  runtime.discordRestyleStarted = true
  setTimeout(async () => {
    try {
      const stored = await prisma.systemSetting.findUnique({ where: { key: STYLE_VERSION_KEY } })
      if (Number(stored?.value ?? 0) >= DISCORD_STYLE_VERSION) return
      const stats = await restyleSentDiscordMessages()
      console.log(`[DiscordRestyle] Style v${DISCORD_STYLE_VERSION}: ${stats.edited} Nachrichten aktualisiert, ${stats.skipped} übersprungen, ${stats.failed} Fehler in ${stats.channels} Channels`)
      if (stats.failed === 0) {
        const value = String(DISCORD_STYLE_VERSION)
        await prisma.systemSetting.upsert({ where: { key: STYLE_VERSION_KEY }, create: { key: STYLE_VERSION_KEY, value }, update: { value } })
      }
    } catch (error) {
      console.error('[DiscordRestyle] Nachziehen fehlgeschlagen:', error)
    }
  }, START_DELAY_MS).unref()
}
