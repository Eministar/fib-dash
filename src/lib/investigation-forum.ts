import { prisma } from '@/lib/prisma'
import { readFile } from 'node:fs/promises'

import { DISCORD_UPLOAD_LIMIT_BYTES, DiscordApiError, discordFetch, getDiscordConfig, postChannelMessageWithFiles, type DiscordUploadFile } from '@/lib/discord-integration'
import { resolveClipPath } from '@/lib/clips'
import { photoPath } from '@/lib/investigation-photos'
import { agentDisplayName } from '@/lib/investigations-server'
import { resolveBaseUrl } from '@/lib/site'
import {
  dossierCard,
  dossierOverview,
  forumEventMessage,
  forumThreadName,
  investigationCard,
  type ForumEventType,
} from '@/lib/investigation-forum-messages'

/**
 * Ermittlungs-Forum auf Discord: je Einsatzakte ein Beitrag (Startnachricht =
 * aktuelle Aktenkarte, darunter der Verlauf), je Dauerakte ein Beitrag mit
 * Tag „Dauerakte“ und Links zu ihren Akten, dazu ein angepinnter Beitrag mit
 * allen Dauerakten. Beitrag-IDs liegen an Akte bzw. Dauerakte; in einem Forum
 * ist die Thread-ID zugleich die ID der Startnachricht.
 */

const FORUM_CHANNEL_TYPE = 15
const OVERVIEW_KEY = 'discord.investigationsForumOverviewThreadId'
const CHANNEL_CACHE_MS = 5 * 60_000
/** Discord-Flag für den angepinnten Beitrag eines Forums. */
const THREAD_PINNED = 1 << 1
const RUNNING_STATUSES = ['OPEN', 'ACTIVE', 'SUSPENDED'] as const

export const FORUM_TAGS = {
  case: 'Einsatzakte',
  dossier: 'Dauerakte',
  closed: 'Abgeschlossen',
  overview: 'Übersicht',
} as const

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
  const missing = Object.values(FORUM_TAGS).filter((name) => !tags.some((tag) => tag.name === name))
  if (missing.length > 0) {
    try {
      const updated = await discordFetch<ForumChannel>(`/channels/${forum.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available_tags: [...tags, ...missing.map((name) => ({ name }))] }),
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
 * Thread-ID zurück und meldet, ob er neu ist (dann folgen die Dauerakten).
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
        id: true, title: true, kind: true, description: true, address: true, discordThreadId: true,
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

    const name = forumThreadName('Dauerakte', dossier.title)
    const message = dossierCard({
      title: dossier.title,
      kind: dossier.kind,
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
      orderBy: [{ kind: 'asc' }, { title: 'asc' }],
      select: { title: true, kind: true, discordThreadId: true, _count: { select: { investigations: true } } },
    })
    const message = dossierOverview(dossiers.map((d) => ({ title: d.title, kind: d.kind, threadId: d.discordThreadId, caseCount: d._count.investigations })))
    const name = '📚 Dauerakten – Übersicht'
    const tagIds = pickTags(tags, [FORUM_TAGS.overview])

    const stored = await prisma.systemSetting.findUnique({ where: { key: OVERVIEW_KEY } })
    let threadId = stored?.value || null
    if (!threadId || !await updatePost(threadId, name, message, tagIds)) {
      threadId = await createPost(forum, name, message, tagIds)
      await prisma.systemSetting.upsert({ where: { key: OVERVIEW_KEY }, create: { key: OVERVIEW_KEY, value: threadId }, update: { value: threadId } })
    }
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
}) {
  const ctx = await context()
  if (!ctx) return false

  const post = await syncInvestigationPost(ctx.forum, ctx.tags, event.investigationId)
  if (!post) return true
  if (event.type !== 'created') {
    const files = await eventFiles(event, post.threadId)
    const rows = [...(event.rows ?? []), ...(files.skipped ? [{ label: 'Hinweis', value: files.skipped }] : [])]
    const message = forumEventMessage({ type: event.type, rows, note: event.note, actorName: event.actorName })
    await discordFetch(`/channels/${post.threadId}/messages`, { method: 'POST', body: JSON.stringify(message) })
    // Dateien als schlichte Nachricht darunter: Komponenten-Nachrichten zeigen Anhänge
    // nur über eigene Bausteine, normale Nachrichten spielen Bilder und Videos direkt ab.
    for (const batch of files.batches) {
      await postChannelMessageWithFiles(post.threadId, { allowed_mentions: { parse: [] } }, batch)
    }
  }
  // Neuer Beitrag oder geänderter Status: die Links in den Dauerakten nachziehen.
  if (post.created || event.type === 'status' || event.type === 'closed') await refreshDossiers(ctx, post.dossierIds)
  return true
}

const MAX_FILES_PER_MESSAGE = 10

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
      if (data) batches.push([{ name: clip.originalName || clip.filename, data, contentType: clip.mimeType }])
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

/** Nach dem Speichern oder Verknüpfen einer Dauerakte. */
export async function syncDossierForum(dossierId: string) {
  const ctx = await context()
  if (!ctx) return
  await syncDossierPost(ctx.forum, ctx.tags, dossierId, true)
  await syncOverviewPost(ctx.forum, ctx.tags)
}

/** Beitrag einer gelöschten Akte oder Dauerakte entfernen. */
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
 * Einmaliger Aufbau: Beiträge für alle laufenden Akten und alle Dauerakten
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
