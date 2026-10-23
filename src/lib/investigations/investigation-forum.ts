import { prisma } from '@/lib/prisma'
import { readFile } from 'node:fs/promises'

import { DISCORD_UPLOAD_LIMIT_BYTES, DiscordApiError, discordFetch, getDiscordConfig, postChannelMessageWithFiles, type DiscordUploadFile } from '@/lib/discord/discord-integration'
import { componentMessage, mediaGallery } from '@/lib/discord/discord-components'
import { resolveClipPath } from '@/lib/media/clips'
import { photoPath } from '@/lib/investigations/investigation-photos'
import { agentDisplayName } from '@/lib/investigations/investigations-server'
import { resolveBaseUrl } from '@/lib/site'
import {
  caseOverview,
  dossierCard,
  dossierOverview,
  forumEntryMessage,
  forumEventMessage,
  forumThreadName,
  investigationCard,
  type ForumEventType,
} from '@/lib/investigations/investigation-forum-messages'
import { INVESTIGATION_ENTRY_KIND_LABELS } from '@/lib/investigations/investigations'

/**
 * Ermittlungs-Forum auf Discord: je Einsatzakte ein Beitrag (Startnachricht =
 * aktuelle Aktenkarte, darunter der Verlauf), je Familienakte ein Beitrag mit
 * Tag „Familienakte“ und Links zu ihren Akten, dazu ein angepinnter Beitrag mit
 * allen Familienakten. Beitrag-IDs liegen an Akte bzw. Familienakte; in einem Forum
 * ist die Thread-ID zugleich die ID der Startnachricht.
 */

const FORUM_CHANNEL_TYPE = 15
const OVERVIEW_KEY = 'discord.investigationsForumOverviewThreadId'
/** Zweite Nachricht im Übersichts-Beitrag: alle laufenden Einsatzakten. */
const OVERVIEW_CASES_KEY = 'discord.investigationsForumOverviewCasesMessageId'
const CHANNEL_CACHE_MS = 5 * 60_000
/** Discord-Flag für den angepinnten Beitrag eines Forums. */
const THREAD_PINNED = 1 << 1
const RUNNING_STATUSES = ['OPEN', 'ACTIVE', 'SUSPENDED'] as const

export const FORUM_TAGS = {
  case: 'Einsatzakte',
  dossier: 'Familienakte',
  closed: 'Abgeschlossen',
  overview: 'Übersicht',
} as const

/** Frühere Tag-Namen, die beim nächsten Abgleich umbenannt werden. */
const RENAMED_TAGS: Record<string, string> = { Dauerakte: FORUM_TAGS.dossier }

type ForumTag = { id: string; name: string; moderated?: boolean; emoji_id?: string | null; emoji_name?: string | null }
type ForumChannel = { id: string; type: number; available_tags?: ForumTag[] }

const channelCache = new Map<string, { at: number; channel: ForumChannel }>()

async function loadChannel(channelId: string, fresh = false) {
  const cached = channelCache.get(channelId)
  if (!fresh && cached && Date.now() - cached.at < CHANNEL_CACHE_MS) return cached.channel
  const channel = await discordFetch<ForumChannel>(`/channels/${channelId}`)
  channelCache.set(channelId, { at: Date.now(), channel })
  return channel
}

/** Der eingestellte Ermittlungs-Channel, falls er ein Forum ist. */
export async function investigationForum(): Promise<ForumChannel | null> {
  const { investigationsChannelId } = await getDiscordConfig()
  if (!investigationsChannelId) return null
  const channel = await loadChannel(investigationsChannelId)
  return channel.type === FORUM_CHANNEL_TYPE ? channel : null
}

/**
 * Tag-IDs nach Name. Fehlende Tags werden angelegt; dafür braucht der Bot
 * „Kanäle verwalten“ – ohne das Recht laufen Beiträge eben ohne Tag.
 */
async function forumTags(forum: ForumChannel): Promise<Map<string, string>> {
  let tags = forum.available_tags ?? []
  // Umbenannte Tags behalten ihre ID, damit bestehende Beiträge den Tag behalten.
  const renamed = tags.map((tag) => {
    const next = RENAMED_TAGS[tag.name]
    return next && !tags.some((other) => other.name === next) ? { ...tag, name: next } : tag
  })
  const missing = Object.values(FORUM_TAGS).filter((name) => !renamed.some((tag) => tag.name === name))
  if (missing.length > 0 || renamed.some((tag, index) => tag !== tags[index])) {
    try {
      const updated = await discordFetch<ForumChannel>(`/channels/${forum.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available_tags: [...renamed, ...missing.map((name) => ({ name }))] }),
      })
      channelCache.set(forum.id, { at: Date.now(), channel: updated })
      tags = updated.available_tags ?? tags
    } catch (error) {
      console.warn('[InvestigationForum] Tags konnten nicht angelegt werden (Bot braucht „Kanäle verwalten“):', error)
    }
  }
  return new Map(tags.map((tag) => [tag.name, tag.id]))
}

function pickTags(tags: Map<string, string>, names: string[]) {
  return names.map((name) => tags.get(name)).filter((id): id is string => Boolean(id))
}

const isGone = (error: unknown) => error instanceof DiscordApiError && error.status === 404

async function createPost(forum: ForumChannel, name: string, message: Record<string, unknown>, tagIds: string[]) {
  const thread = await discordFetch<{ id: string }>(`/channels/${forum.id}/threads`, {
    method: 'POST',
    body: JSON.stringify({ name, message, applied_tags: tagIds }),
  })
  return thread.id
}

/** Startnachricht, Titel und Tags eines bestehenden Beitrags. `false` = Beitrag gibt es nicht mehr. */
async function updatePost(threadId: string, name: string, message: Record<string, unknown>, tagIds: string[]) {
  try {
    await discordFetch(`/channels/${threadId}`, { method: 'PATCH', body: JSON.stringify({ name, applied_tags: tagIds, archived: false }) })
    await discordFetch(`/channels/${threadId}/messages/${threadId}`, { method: 'PATCH', body: JSON.stringify(message) })
    return true
  } catch (error) {
    if (isGone(error)) return false
    throw error
  }
}

function dashboardUrl(path: string) {
  const base = resolveBaseUrl()
  return base ? `${base}${path}` : undefined
}

// Gleichzeitige Meldungen zur selben Akte dürfen keinen zweiten Beitrag anlegen.
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  locks.set(key, next)
  void next.finally(() => { if (locks.get(key) === next) locks.delete(key) }).catch(() => undefined)
  return next
}

const investigationCardSelect = {
  id: true,
  caseNumber: true,
  title: true,
  summary: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  discordThreadId: true,
  leadAgent: { select: { firstName: true, lastName: true, badgeNumber: true } },
  _count: { select: { assignees: true, entries: true, clips: true } },
  dossiers: { select: { id: true } },
} as const

type CardRow = NonNullable<Awaited<ReturnType<typeof loadInvestigation>>>

function loadInvestigation(id: string) {
  return prisma.investigation.findUnique({ where: { id }, select: investigationCardSelect })
}

function cardFor(row: CardRow) {
  return investigationCard({
    caseNumber: row.caseNumber,
    title: row.title,
    summary: row.summary,
    status: row.status,
    priority: row.priority,
    leadAgentName: agentDisplayName(row.leadAgent),
    assigneeCount: row._count.assignees,
    entryCount: row._count.entries,
    clipCount: row._count.clips,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    url: dashboardUrl(`/investigations/${row.id}`),
  })
}

function caseTagNames(status: string) {
  return status === 'CLOSED' || status === 'ARCHIVED' ? [FORUM_TAGS.case, FORUM_TAGS.closed] : [FORUM_TAGS.case]
}

/**
 * Beitrag einer Akte anlegen oder auf den aktuellen Stand bringen. Gibt die
 * Thread-ID zurück und meldet, ob er neu ist (dann folgen die Familienakten).
 */
async function syncInvestigationPost(forum: ForumChannel, tags: Map<string, string>, id: string) {
  return withLock(`case:${id}`, async () => {
    const row = await loadInvestigation(id)
    if (!row) return null
    const name = forumThreadName(row.caseNumber, row.title)
    const message = cardFor(row)
    const tagIds = pickTags(tags, caseTagNames(row.status))

    if (row.discordThreadId && await updatePost(row.discordThreadId, name, message, tagIds)) {
      return { threadId: row.discordThreadId, created: false, dossierIds: row.dossiers.map((d) => d.id) }
    }
    const threadId = await createPost(forum, name, message, tagIds)
    await prisma.investigation.update({ where: { id }, data: { discordThreadId: threadId }, select: { id: true } })
    return { threadId, created: true, dossierIds: row.dossiers.map((d) => d.id) }
  })
}

async function syncDossierPost(forum: ForumChannel, tags: Map<string, string>, id: string, ensureCases: boolean) {
  return withLock(`dossier:${id}`, async () => {
    const dossier = await prisma.dossier.findUnique({
      where: { id },
      select: {
        id: true, title: true, description: true, address: true, discordThreadId: true,
        leader: { select: { firstName: true, lastName: true } },
        _count: { select: { persons: true, vehicles: true } },
        investigations: { select: { id: true, caseNumber: true, title: true, status: true, discordThreadId: true }, orderBy: { updatedAt: 'desc' } },
      },
    })
    if (!dossier) return null

    // Damit die Links funktionieren, braucht jede verknüpfte Akte einen Beitrag.
    const cases = []
    for (const item of dossier.investigations) {
      let threadId = item.discordThreadId
      if (!threadId && ensureCases) threadId = (await syncInvestigationPost(forum, tags, item.id))?.threadId ?? null
      cases.push({ caseNumber: item.caseNumber, title: item.title, status: item.status, threadId })
    }

    const name = forumThreadName('Familienakte', dossier.title)
    const message = dossierCard({
      title: dossier.title,
      leader: dossier.leader ? `${dossier.leader.firstName} ${dossier.leader.lastName}` : null,
      description: dossier.description,
      address: dossier.address,
      personCount: dossier._count.persons,
      vehicleCount: dossier._count.vehicles,
      cases,
      url: dashboardUrl(`/investigations/dossiers?id=${encodeURIComponent(dossier.id)}`),
    })
    const tagIds = pickTags(tags, [FORUM_TAGS.dossier])
    if (dossier.discordThreadId && await updatePost(dossier.discordThreadId, name, message, tagIds)) return dossier.discordThreadId
    const threadId = await createPost(forum, name, message, tagIds)
    await prisma.dossier.update({ where: { id }, data: { discordThreadId: threadId }, select: { id: true } })
    return threadId
  })
}

async function syncOverviewPost(forum: ForumChannel, tags: Map<string, string>) {
  return withLock('overview', async () => {
    const dossiers = await prisma.dossier.findMany({
      orderBy: { title: 'asc' },
      select: { title: true, discordThreadId: true, _count: { select: { investigations: true } } },
    })
    const message = dossierOverview(dossiers.map((d) => ({ title: d.title, threadId: d.discordThreadId, caseCount: d._count.investigations })))
    const name = '📚 Familienregister – Übersicht'
    const tagIds = pickTags(tags, [FORUM_TAGS.overview])

    const stored = await prisma.systemSetting.findUnique({ where: { key: OVERVIEW_KEY } })
    let threadId = stored?.value || null
    if (!threadId || !await updatePost(threadId, name, message, tagIds)) {
      threadId = await createPost(forum, name, message, tagIds)
      await prisma.systemSetting.upsert({ where: { key: OVERVIEW_KEY }, create: { key: OVERVIEW_KEY, value: threadId }, update: { value: threadId } })
    }
    await syncOverviewCases(threadId)
    try {
      await discordFetch(`/channels/${threadId}`, { method: 'PATCH', body: JSON.stringify({ flags: THREAD_PINNED }) })
    } catch (error) {
      // Ein Forum hat höchstens einen angepinnten Beitrag – ist ein anderer
      // angepinnt, bleibt die Übersicht trotzdem aktuell.
      console.warn('[InvestigationForum] Übersicht konnte nicht angepinnt werden:', error)
    }
    return threadId
  })
}

/** Laufende Einsatzakten als zweite, immer wieder bearbeitete Nachricht im Übersichts-Beitrag. */
async function syncOverviewCases(threadId: string) {
  const running = await prisma.investigation.findMany({
    where: { status: { in: [...RUNNING_STATUSES] } },
    orderBy: [{ updatedAt: 'desc' }],
    select: { caseNumber: true, title: true, status: true, discordThreadId: true, dossiers: { select: { title: true }, take: 1 } },
  })
  const message = caseOverview(running.map((item) => ({
    caseNumber: item.caseNumber, title: item.title, status: item.status, threadId: item.discordThreadId, family: item.dossiers[0]?.title ?? null,
  })))
  const stored = await prisma.systemSetting.findUnique({ where: { key: OVERVIEW_CASES_KEY } })
  if (stored?.value) {
    try {
      await discordFetch(`/channels/${threadId}/messages/${stored.value}`, { method: 'PATCH', body: JSON.stringify(message) })
      return
    } catch (error) {
      if (!isGone(error)) throw error
    }
  }
  const posted = await discordFetch<{ id: string }>(`/channels/${threadId}/messages`, { method: 'POST', body: JSON.stringify(message) })
  await prisma.systemSetting.upsert({ where: { key: OVERVIEW_CASES_KEY }, create: { key: OVERVIEW_CASES_KEY, value: posted.id }, update: { value: posted.id } })
}

async function context() {
  const forum = await investigationForum()
  if (!forum) return null
  return { forum, tags: await forumTags(forum) }
}

async function refreshDossiers(ctx: { forum: ForumChannel; tags: Map<string, string> }, dossierIds: string[]) {
  for (const dossierId of dossierIds) await syncDossierPost(ctx.forum, ctx.tags, dossierId, false)
  if (dossierIds.length) await syncOverviewPost(ctx.forum, ctx.tags)
}

/**
 * Meldung zu einer Akte im Forum. `false`, wenn der Channel kein Forum ist –
 * dann postet der Aufrufer wie bisher eine einzelne Nachricht.
 */
export async function postInvestigationForumEvent(event: {
  type: 'created' | ForumEventType
  investigationId: string
  rows?: Array<{ label: string; value: string | null | undefined }>
  note?: string | null
  actorName?: string | null
  clipId?: string
  photoIds?: string[]
  /** Chronologie-Eintrag, zu dem die Meldung gehört – dann wird sie mit ihm verknüpft. */
  entryId?: string
}) {
  const ctx = await context()
  if (!ctx) return false

  const post = await syncInvestigationPost(ctx.forum, ctx.tags, event.investigationId)
  if (!post) return true
  if (event.type !== 'created') {
    const files = await eventFiles(event, post.threadId)
    const rows = [...(event.rows ?? []), ...(files.skipped ? [{ label: 'Hinweis', value: files.skipped }] : [])]
    const [first, ...rest] = files.batches
    const media = first?.map((file) => file.name)
    const entry = event.type === 'entry' && event.entryId ? await loadEntry(event.entryId) : null
    const message = entry
      ? forumEntryMessage(entry.data, media)
      : forumEventMessage({ type: event.type, rows, note: event.note, actorName: event.actorName, media })
    // Bilder und Videos stehen eingebettet in derselben Nachricht (Media Gallery).
    const posted = first
      ? await postChannelMessageWithFiles(post.threadId, message, first)
      : await discordFetch<{ id: string }>(`/channels/${post.threadId}/messages`, { method: 'POST', body: JSON.stringify(message) })
    for (const batch of rest) {
      await postChannelMessageWithFiles(post.threadId, galleryOnly(batch), batch)
    }
    if (entry) {
      await prisma.investigationEntry.updateMany({ where: { id: entry.id, discordMessageId: null }, data: { discordMessageId: posted.id } })
    }
  }
  // Neuer Beitrag oder geänderter Status: Familienakten und Übersicht nachziehen.
  if (post.created || event.type === 'status' || event.type === 'closed') {
    await refreshDossiers(ctx, post.dossierIds)
    if (!post.dossierIds.length) await syncOverviewPost(ctx.forum, ctx.tags)
  }
  return true
}

function galleryOnly(files: DiscordUploadFile[]) {
  return componentMessage([mediaGallery(files.map((file) => `attachment://${file.name}`))])
}

async function loadEntry(entryId: string) {
  const entry = await prisma.investigationEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true, kind: true, title: true, location: true, content: true, occurredAt: true, discordMessageId: true,
      createdBy: { select: { displayName: true } },
      investigation: { select: { id: true, discordThreadId: true } },
    },
  })
  if (!entry) return null
  return {
    id: entry.id,
    messageId: entry.discordMessageId,
    threadId: entry.investigation.discordThreadId,
    investigationId: entry.investigation.id,
    data: {
      kindLabel: INVESTIGATION_ENTRY_KIND_LABELS[entry.kind as keyof typeof INVESTIGATION_ENTRY_KIND_LABELS] ?? 'Eintrag',
      title: entry.title,
      location: entry.location,
      content: entry.content,
      authorName: entry.createdBy?.displayName ?? null,
      occurredAt: entry.occurredAt,
    },
  }
}

/** Discord-Fehler „Nachricht gehört einem anderen Nutzer“ bzw. fehlende Rechte. */
const isForeignMessage = (error: unknown) => error instanceof DiscordApiError && (error.status === 403 || error.code === 50005)

/**
 * Bearbeiteter Eintrag im Dashboard: die zugehörige Nachricht im Akten-Beitrag
 * nachziehen. Antworten, die selbst aus Discord stammen, gehören ihrem Autor –
 * die kann der Bot nicht bearbeiten, dann bleibt es beim Dashboard.
 */
export async function syncForumEntry(entryId: string) {
  const entry = await loadEntry(entryId)
  if (!entry?.threadId || !entry.messageId) return
  try {
    await discordFetch(`/channels/${entry.threadId}/messages/${entry.messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ components: forumEntryMessage(entry.data).components }),
    })
  } catch (error) {
    if (!isGone(error) && !isForeignMessage(error)) throw error
  }
  await refreshInvestigationForumCard(entry.investigationId)
}

/** Gelöschter Eintrag: die vom Bot gepostete Nachricht entfernen, fremde Antworten bleiben stehen. */
export async function removeForumEntry(investigationId: string, threadId: string | null, messageId: string | null) {
  if (threadId && messageId) {
    try {
      const message = await discordFetch<{ author?: { bot?: boolean } }>(`/channels/${threadId}/messages/${messageId}`)
      if (message.author?.bot) await discordFetch(`/channels/${threadId}/messages/${messageId}`, { method: 'DELETE' })
    } catch (error) {
      if (!isGone(error) && !isForeignMessage(error)) throw error
    }
  }
  await refreshInvestigationForumCard(investigationId)
}

const MAX_FILES_PER_MESSAGE = 10

/** Discord findet `attachment://…` nur bei schlichten Dateinamen. */
function attachmentName(name: string) {
  const clean = name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '')
  return clean.slice(-80) || 'datei'
}

/**
 * Anhänge für eine Meldung: Clip-Video bzw. Bilder, in Gruppen unter der
 * Upload-Grenze. Zu Großes wird nicht angehängt, sondern als Hinweis genannt.
 * Bilder, die selbst aus diesem Beitrag stammen, werden nicht zurückgespiegelt.
 */
async function eventFiles(event: { clipId?: string; photoIds?: string[] }, threadId: string) {
  const batches: DiscordUploadFile[][] = []
  let skipped = ''
  if (event.clipId) {
    const clip = await prisma.bodycamClip.findUnique({ where: { id: event.clipId }, select: { filename: true, originalName: true, mimeType: true, sizeBytes: true } })
    if (clip && Number(clip.sizeBytes) <= DISCORD_UPLOAD_LIMIT_BYTES) {
      const data = await readFile(resolveClipPath(clip.filename)).catch(() => null)
      if (data) batches.push([{ name: attachmentName(clip.originalName || clip.filename), data, contentType: clip.mimeType }])
    } else if (clip) {
      skipped = `Video ist ${Math.round(Number(clip.sizeBytes) / 1024 / 1024)} MB groß – zu groß für Discord, im Dashboard ansehen.`
    }
  }
  if (event.photoIds?.length) {
    const photos = await prisma.investigationPhoto.findMany({
      where: { id: { in: event.photoIds }, NOT: { channelId: threadId } },
      select: { filename: true, title: true, mimeType: true, sizeBytes: true },
    })
    let current: DiscordUploadFile[] = []
    let currentBytes = 0
    for (const photo of photos) {
      if (photo.sizeBytes > DISCORD_UPLOAD_LIMIT_BYTES) continue
      const data = await readFile(photoPath(photo.filename)).catch(() => null)
      if (!data) continue
      if (current.length >= MAX_FILES_PER_MESSAGE || currentBytes + data.length > DISCORD_UPLOAD_LIMIT_BYTES) {
        batches.push(current)
        current = []
        currentBytes = 0
      }
      current.push({ name: photo.filename, data, contentType: photo.mimeType })
      currentBytes += data.length
    }
    if (current.length) batches.push(current)
  }
  return { batches, skipped }
}

/** Aktenkarte nachziehen, wenn sich etwas ohne eigene Verlaufsmeldung ändert (Titel, Einträge …). */
export async function refreshInvestigationForumCard(investigationId: string) {
  const ctx = await context()
  if (!ctx) return
  const post = await syncInvestigationPost(ctx.forum, ctx.tags, investigationId)
  if (post?.created) await refreshDossiers(ctx, post.dossierIds)
}

/** Nach dem Speichern oder Verknüpfen einer Familienakte. */
export async function syncDossierForum(dossierId: string) {
  const ctx = await context()
  if (!ctx) return
  await syncDossierPost(ctx.forum, ctx.tags, dossierId, true)
  await syncOverviewPost(ctx.forum, ctx.tags)
}

/** Beitrag einer gelöschten Akte oder Familienakte entfernen. */
export async function removeForumPost(threadId: string | null | undefined, affectedDossierIds: string[] = []) {
  const ctx = await context()
  if (!ctx) return
  if (threadId) {
    await discordFetch(`/channels/${threadId}`, { method: 'DELETE' }).catch((error) => { if (!isGone(error)) throw error })
  }
  await refreshDossiers(ctx, affectedDossierIds)
  await syncOverviewPost(ctx.forum, ctx.tags)
}

/**
 * Einmaliger Aufbau: Beiträge für alle laufenden Akten und alle Familienakten
 * (samt ihrer verknüpften Akten), dazu die angepinnte Übersicht. Bestehende
 * Beiträge werden nur aktualisiert, nicht doppelt angelegt.
 */
export async function rebuildInvestigationForum() {
  const ctx = await context()
  if (!ctx) throw new Error('Der Ermittlungs-Channel ist kein Forum')
  const running = await prisma.investigation.findMany({ where: { status: { in: [...RUNNING_STATUSES] } }, select: { id: true }, orderBy: { createdAt: 'asc' } })
  for (const item of running) await syncInvestigationPost(ctx.forum, ctx.tags, item.id)
  const dossiers = await prisma.dossier.findMany({ select: { id: true }, orderBy: { title: 'asc' } })
  for (const dossier of dossiers) await syncDossierPost(ctx.forum, ctx.tags, dossier.id, true)
  await syncOverviewPost(ctx.forum, ctx.tags)
  return { investigations: running.length, dossiers: dossiers.length }
}

/** Hintergrund-Aufruf ohne den Request aufzuhalten; Fehler landen im Log. */
export function queueForumTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => console.error(`[InvestigationForum] ${label} fehlgeschlagen:`, error))
}
