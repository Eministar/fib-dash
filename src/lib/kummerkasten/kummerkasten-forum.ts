import { prisma } from '@/lib/prisma'
import { DiscordApiError, discordFetch, getDiscordConfig, postChannelMessageWithFiles } from '@/lib/discord/discord-integration'
import {
  actionRow,
  componentMessage,
  iconLine,
  linkButton,
  markdownPlain,
  markdownQuote,
  markdownTitle,
  mediaGallery,
  separator,
  textDisplay,
} from '@/lib/discord/discord-components'
import { forumThreadName } from '@/lib/investigations/investigation-forum-messages'
import { resolveBaseUrl } from '@/lib/site'
import { KUMMERKASTEN_STATUS_LABELS, kummerkastenNumber, type KummerkastenStatusValue } from './kummerkasten'
import { readKummerkastenImage } from './kummerkasten-images'

/**
 * Kummerkasten-Forum im FIB-Discord: je Einsendung ein Beitrag. Startnachricht =
 * Karte (Betreff, Absender, Status, Text), danach ggf. das Bild und Überlänge des
 * Texts. Bei Statuswechsel werden nur Karte und Tags aktualisiert.
 */

const FORUM_CHANNEL_TYPE = 15
const CHANNEL_CACHE_MS = 5 * 60_000
/** Discord erlaubt pro Nachricht insgesamt 4000 Zeichen Text in Components. */
const CARD_MESSAGE_CHARS = 2800
const FOLLOW_UP_CHARS = 3800

export const KUMMERKASTEN_TAGS = {
  anonymous: 'Anonym',
  named: 'Mit Namen',
  OPEN: 'Offen',
  IN_PROGRESS: 'In Bearbeitung',
  DONE: 'Erledigt',
} as const

type ForumTag = { id: string; name: string }
type ForumChannel = { id: string; type: number; available_tags?: ForumTag[] }

const channelCache = new Map<string, { at: number; channel: ForumChannel }>()

async function loadChannel(channelId: string) {
  const cached = channelCache.get(channelId)
  if (cached && Date.now() - cached.at < CHANNEL_CACHE_MS) return cached.channel
  const channel = await discordFetch<ForumChannel>(`/channels/${channelId}`)
  channelCache.set(channelId, { at: Date.now(), channel })
  return channel
}

/** Der eingestellte Kummerkasten-Channel, falls er ein Forum ist. */
export async function kummerkastenForum(): Promise<ForumChannel | null> {
  const { kummerkastenChannelId } = await getDiscordConfig()
  if (!kummerkastenChannelId) return null
  const channel = await loadChannel(kummerkastenChannelId)
  return channel.type === FORUM_CHANNEL_TYPE ? channel : null
}

/** Tag-IDs nach Name; fehlende Tags werden angelegt (braucht „Kanäle verwalten“). */
async function forumTags(forum: ForumChannel): Promise<Map<string, string>> {
  let tags = forum.available_tags ?? []
  const missing = Object.values(KUMMERKASTEN_TAGS).filter((name) => !tags.some((tag) => tag.name === name))
  if (missing.length > 0 && tags.length + missing.length <= 20) {
    try {
      const updated = await discordFetch<ForumChannel>(`/channels/${forum.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available_tags: [...tags, ...missing.map((name) => ({ name }))] }),
      })
      channelCache.set(forum.id, { at: Date.now(), channel: updated })
      tags = updated.available_tags ?? tags
    } catch (error) {
      console.warn('[Kummerkasten] Forum-Tags konnten nicht angelegt werden (Bot braucht „Kanäle verwalten“):', error instanceof Error ? error.message : error)
    }
  }
  return new Map(tags.map((tag) => [tag.name, tag.id]))
}

type EntryRow = {
  id: number
  subject: string
  message: string
  anonymous: boolean
  authorName: string | null
  authorDiscordId: string | null
  imageFilename: string | null
  imageMimeType: string | null
  status: KummerkastenStatusValue
  discordThreadId: string | null
  createdAt: Date
}

const entrySelect = {
  id: true, subject: true, message: true, anonymous: true, authorName: true, authorDiscordId: true,
  imageFilename: true, imageMimeType: true, status: true, discordThreadId: true, createdAt: true,
} as const

function tagIdsFor(entry: EntryRow, tags: Map<string, string>) {
  return [entry.anonymous ? KUMMERKASTEN_TAGS.anonymous : KUMMERKASTEN_TAGS.named, KUMMERKASTEN_TAGS[entry.status]]
    .map((name) => tags.get(name))
    .filter((id): id is string => Boolean(id))
}

function clip(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

/** Text in Stücke für Folgenachrichten schneiden (bevorzugt an Zeilenumbrüchen). */
export function splitMessage(value: string, max: number) {
  const parts: string[] = []
  let rest = value
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max)
    if (cut < max / 2) cut = max
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

export function kummerkastenCard(entry: EntryRow, url?: string) {
  const number = kummerkastenNumber(entry.id)
  const sender = entry.anonymous
    ? iconLine('🕶️', '**Absender:** Anonym, Rückfragen sind nicht möglich')
    : iconLine('👤', `**Absender:** ${markdownPlain(entry.authorName ?? 'Unbekannt')} · <@${entry.authorDiscordId}> · \`${entry.authorDiscordId}\``)
  const unix = Math.floor(entry.createdAt.getTime() / 1000)
  const truncated = entry.message.length > CARD_MESSAGE_CHARS

  const components = [
    textDisplay([
      markdownTitle('📮', `${number} · ${markdownPlain(clip(entry.subject, 120))}`),
      sender,
      iconLine('🕓', `**Eingegangen:** <t:${unix}:f>`),
      iconLine('📌', `**Status:** ${KUMMERKASTEN_STATUS_LABELS[entry.status]}`),
    ].join('\n')),
    separator(),
    textDisplay(markdownQuote(markdownPlain(truncated ? entry.message.slice(0, CARD_MESSAGE_CHARS) + ' …' : entry.message))
      + (truncated ? '\n-# Fortsetzung in den nächsten Nachrichten.' : '')),
  ]
  if (url) components.push(actionRow([linkButton('Im Dashboard öffnen', url)]))
  // Keine Pings: Die Erwähnung dient nur als klickbares Profil.
  return componentMessage(components, { allowedMentions: { parse: [] } })
}

function dashboardUrl(id: number) {
  const base = resolveBaseUrl()
  return base ? `${base}/kummerkasten/${id}` : undefined
}

// Gleichzeitige Syncs derselben Einsendung dürfen keinen zweiten Beitrag anlegen.
const locks = new Map<number, Promise<unknown>>()
function withLock<T>(id: number, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  locks.set(id, next)
  void next.finally(() => { if (locks.get(id) === next) locks.delete(id) }).catch(() => undefined)
  return next
}

const isGone = (error: unknown) => error instanceof DiscordApiError && error.status === 404

/**
 * Legt den Forum-Beitrag einer Einsendung an oder bringt Karte, Titel und Tags auf
 * den aktuellen Stand. Gibt die Thread-ID zurück, oder null ohne eingestelltes Forum.
 */
export async function syncKummerkastenPost(id: number): Promise<string | null> {
  const forum = await kummerkastenForum()
  if (!forum) return null
  const tags = await forumTags(forum)

  return withLock(id, async () => {
    const entry = await prisma.kummerkastenEntry.findUnique({ where: { id }, select: entrySelect }) as EntryRow | null
    if (!entry) return null
    const name = forumThreadName(kummerkastenNumber(entry.id), entry.subject)
    const card = kummerkastenCard(entry, dashboardUrl(entry.id))
    const appliedTags = tagIdsFor(entry, tags)
    const archived = entry.status === 'DONE'

    if (entry.discordThreadId) {
      try {
        // Erst entarchivieren, sonst lässt sich die Startnachricht nicht bearbeiten.
        await discordFetch(`/channels/${entry.discordThreadId}`, { method: 'PATCH', body: JSON.stringify({ archived: false, name, applied_tags: appliedTags }) })
        await discordFetch(`/channels/${entry.discordThreadId}/messages/${entry.discordThreadId}`, { method: 'PATCH', body: JSON.stringify(card) })
        if (archived) await discordFetch(`/channels/${entry.discordThreadId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
        return entry.discordThreadId
      } catch (error) {
        if (!isGone(error)) throw error
        // Beitrag wurde in Discord gelöscht → neu anlegen.
      }
    }

    const thread = await discordFetch<{ id: string }>(`/channels/${forum.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({ name, message: card, applied_tags: appliedTags }),
    })
    await prisma.kummerkastenEntry.update({ where: { id }, data: { discordThreadId: thread.id }, select: { id: true } })

    // Überlänge des Texts als Folgenachrichten.
    if (entry.message.length > CARD_MESSAGE_CHARS) {
      for (const part of splitMessage(entry.message.slice(CARD_MESSAGE_CHARS), FOLLOW_UP_CHARS)) {
        await discordFetch(`/channels/${thread.id}/messages`, {
          method: 'POST',
          body: JSON.stringify(componentMessage([textDisplay(markdownQuote(markdownPlain(part)))])),
        })
      }
    }

    if (entry.imageFilename) {
      try {
        const data = await readKummerkastenImage(entry.imageFilename)
        const filename = entry.imageMimeType === 'image/png' ? 'bild.png' : 'bild.jpg'
        await postChannelMessageWithFiles(thread.id, componentMessage([mediaGallery([`attachment://${filename}`])]), [
          { name: filename, data, contentType: entry.imageMimeType ?? 'image/jpeg' },
        ])
      } catch (error) {
        console.warn(`[Kummerkasten] Bild für ${kummerkastenNumber(entry.id)} konnte nicht gepostet werden:`, error instanceof Error ? error.message : error)
      }
    }

    if (archived) await discordFetch(`/channels/${thread.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })
    return thread.id
  })
}

/** Legt für alle Einsendungen ohne Beitrag einen an (älteste zuerst). */
export async function createMissingKummerkastenPosts() {
  const rows = await prisma.kummerkastenEntry.findMany({ where: { discordThreadId: null }, orderBy: { id: 'asc' }, select: { id: true } })
  let created = 0
  for (const row of rows) {
    if (await syncKummerkastenPost(row.id)) created++
  }
  return created
}

export function queueKummerkastenTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => console.error(`[Kummerkasten] ${label} fehlgeschlagen:`, error instanceof Error ? error.message : error))
}
