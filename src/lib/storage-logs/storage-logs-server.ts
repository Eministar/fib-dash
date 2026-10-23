import { prisma } from '@/lib/prisma'
import { error, forbidden, unauthorized } from '@/lib/api-response'
import { discordFetch, getDiscordConfig, postChannelMessage } from '@/lib/discord/discord-integration'
import { isUniqueConstraintError } from '@/lib/core/prisma-errors'
import { resolveBaseUrl } from '@/lib/site'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import {
  DEFAULT_ALERT_SETTINGS,
  buildAgentNameMatcher,
  evaluateWithdrawals,
  isWeaponItem,
  parseStorageEmbed,
  settingNumber,
  snowflakeAt,
  storageAlertMessage,
  storageSlug,
  type AlertSettings,
} from '@/lib/storage-logs/storage-logs'

/**
 * Lagerlogs: Nachrichten des Lager-Webhooks einlesen (live über das Gateway,
 * zur Sicherheit zusätzlich per REST nachgeholt), Agents zuordnen und bei
 * auffälligen Entnahmen warnen.
 */

export const STORAGE_SETTING_KEYS = {
  logChannelId: 'storage.logChannelId',
  alertChannelId: 'storage.alertChannelId',
  alertUserId: 'storage.alertUserId',
  weaponThreshold: 'storage.weaponThreshold',
  itemThreshold: 'storage.itemThreshold',
  windowMinutes: 'storage.windowMinutes',
  cooldownMinutes: 'storage.cooldownMinutes',
  weaponItems: 'storage.weaponItems',
} as const
const CURSOR_KEY = 'storage.cursor'
export const DEFAULT_ALERT_USER_ID = '928021462386892830'

/** Beim ersten Abruf so weit zurück. */
const BACKFILL_DAYS = 14
/** Ältere Entnahmen lösen keine Warnung mehr aus (sonst Ping-Welle beim Nachholen). */
const ALERT_MAX_AGE_MS = 60 * 60_000
const MAX_PAGES_PER_SYNC = 50
const SYNC_INTERVAL_MS = 5 * 60_000

export type StorageSettings = AlertSettings & {
  logChannelId: string
  alertChannelId: string
  alertUserId: string
  weaponItems: string[]
}

export async function getStorageSettings(): Promise<StorageSettings> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(STORAGE_SETTING_KEYS) } } })
  const map = new Map(rows.map((row) => [row.key, row.value]))
  const get = (key: keyof typeof STORAGE_SETTING_KEYS) => map.get(STORAGE_SETTING_KEYS[key])?.trim() ?? ''
  return {
    logChannelId: get('logChannelId'),
    alertChannelId: get('alertChannelId'),
    alertUserId: /^\d{17,22}$/.test(get('alertUserId')) ? get('alertUserId') : DEFAULT_ALERT_USER_ID,
    weaponThreshold: settingNumber(get('weaponThreshold'), DEFAULT_ALERT_SETTINGS.weaponThreshold),
    itemThreshold: settingNumber(get('itemThreshold'), DEFAULT_ALERT_SETTINGS.itemThreshold),
    windowMinutes: Math.max(1, settingNumber(get('windowMinutes'), DEFAULT_ALERT_SETTINGS.windowMinutes, 24 * 60)),
    cooldownMinutes: settingNumber(get('cooldownMinutes'), DEFAULT_ALERT_SETTINGS.cooldownMinutes, 24 * 60),
    weaponItems: get('weaponItems').split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
  }
}

// Namensliste der Agents kurz merken; beim Einlesen vieler Nachrichten sonst je Embed eine Abfrage.
let agentIndexCache: { expiresAt: number; match: (name: string) => string | null } | null = null
async function agentIdForName(name: string) {
  if (!agentIndexCache || Date.now() > agentIndexCache.expiresAt) {
    const agents = await prisma.agent.findMany({ select: { id: true, firstName: true, lastName: true, status: true } })
    agentIndexCache = { expiresAt: Date.now() + 60_000, match: buildAgentNameMatcher(agents) }
  }
  return agentIndexCache.match(name)
}

export type DiscordMessageLike = {
  id: string
  channel_id: string
  timestamp?: string
  embeds?: Array<{ title?: string | null; description?: string | null; timestamp?: string | null }>
}

async function createWithSlug<T>(create: (slug: string) => Promise<T>, prefix: 'LAG' | 'WARN') {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create(storageSlug(prefix))
    } catch (error) {
      // Kollidiert nur der Slug, neu würfeln; ein doppelter sourceKey heißt „schon da“.
      if (!isUniqueConstraintError(error) || String((error as { meta?: { target?: unknown } }).meta?.target ?? '').includes('sourceKey')) throw error
    }
  }
  throw new Error('Kein freier Slug gefunden')
}

/** Eine Discord-Nachricht einlesen. Gibt die neu angelegten Entnahmen zurück. */
export async function ingestStorageMessage(message: DiscordMessageLike, settings?: StorageSettings) {
  const config = settings ?? await getStorageSettings()
  if (!config.logChannelId || message.channel_id !== config.logChannelId) return []

  const created: { agentId: string | null; actorName: string; occurredAt: Date }[] = []
  for (const [index, embed] of (message.embeds ?? []).entries()) {
    const parsed = parseStorageEmbed(embed)
    if (!parsed) continue
    const sourceKey = `${message.id}:${index}`
    if (await prisma.storageLogEntry.findUnique({ where: { sourceKey }, select: { id: true } })) continue
    const occurredAt = new Date(embed.timestamp ?? message.timestamp ?? Date.now())
    const agentId = await agentIdForName(parsed.actorName)
    try {
      await createWithSlug((slug) => prisma.storageLogEntry.create({
        data: {
          slug, sourceKey, channelId: message.channel_id, messageId: message.id,
          direction: parsed.direction, actorName: parsed.actorName, agentId,
          item: parsed.item, quantity: parsed.quantity, isWeapon: isWeaponItem(parsed.item, config.weaponItems),
          storage: parsed.storage, occurredAt, rawText: parsed.rawText,
        },
        select: { id: true },
      }), 'LAG')
    } catch (error) {
      if (isUniqueConstraintError(error)) continue // gleichzeitig vom Gateway und vom Nachholen eingelesen
      throw error
    }
    if (parsed.direction === 'OUT') created.push({ agentId, actorName: parsed.actorName, occurredAt })
  }

  // Je betroffener Person einmal prüfen, nur für frische Entnahmen.
  const fresh = created.filter((entry) => Date.now() - entry.occurredAt.getTime() < ALERT_MAX_AGE_MS)
  const people = new Map(fresh.map((entry) => [entry.agentId ?? `name:${entry.actorName}`, entry]))
  for (const entry of people.values()) await checkStorageAlert(entry, config)
  return created
}

async function checkStorageAlert(target: { agentId: string | null; actorName: string; occurredAt: Date }, settings: StorageSettings) {
  if (!settings.alertChannelId) return
  const now = new Date()
  const who = target.agentId ? { agentId: target.agentId } : { actorName: target.actorName, agentId: null }

  if (settings.cooldownMinutes > 0) {
    const recent = await prisma.storageAlert.findFirst({
      where: { ...who, createdAt: { gte: new Date(now.getTime() - settings.cooldownMinutes * 60_000) } },
      select: { id: true },
    })
    if (recent) return
  }

  const entries = await prisma.storageLogEntry.findMany({
    where: { ...who, direction: 'OUT', occurredAt: { gt: new Date(now.getTime() - settings.windowMinutes * 60_000), lte: now } },
    select: { slug: true, item: true, quantity: true, isWeapon: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  })
  const result = evaluateWithdrawals(entries, now, settings)
  if (!result) return

  const agent = target.agentId
    ? await prisma.agent.findUnique({ where: { id: target.agentId }, select: { firstName: true, lastName: true, badgeNumber: true } })
    : null
  const alert = await createWithSlug((slug) => prisma.storageAlert.create({
    data: {
      slug, agentId: target.agentId, actorName: target.actorName,
      windowStart: result.windowStart, windowEnd: result.windowEnd,
      weaponCount: result.weaponCount, itemCount: result.itemCount, entrySlugs: result.slugs,
    },
  }), 'WARN')

  const inWindow = entries.filter((entry) => result.slugs.includes(entry.slug))
  const message = await postChannelMessage(settings.alertChannelId, storageAlertMessage({
    userId: settings.alertUserId,
    actorName: target.actorName,
    agentLabel: agent ? `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})` : null,
    weaponCount: result.weaponCount,
    itemCount: result.itemCount,
    windowMinutes: settings.windowMinutes,
    reasons: result.reasons,
    entries: inWindow,
    baseUrl: resolveBaseUrl() || undefined,
    alertSlug: alert.slug,
  }))
  await prisma.storageAlert.update({ where: { id: alert.id }, data: { messageId: message.id } })
}

/**
 * Verpasste Nachrichten nachholen (Neustart, Verbindungsabbruch). Liest ab dem
 * zuletzt gesehenen Stand; beim ersten Mal die letzten {@link BACKFILL_DAYS} Tage.
 */
export async function syncStorageLogChannel() {
  const settings = await getStorageSettings()
  if (!settings.logChannelId) return { fetched: 0, created: 0 }
  const cursorRow = await prisma.systemSetting.findUnique({ where: { key: CURSOR_KEY } })
  // Cursor gehört zum Channel; nach einem Channel-Wechsel neu beginnen.
  const [cursorChannel, cursorId] = (cursorRow?.value ?? '').split(':')
  let after = cursorChannel === settings.logChannelId && cursorId ? cursorId : snowflakeAt(new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60_000))

  let fetched = 0
  let created = 0
  for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
    const messages = await discordFetch<DiscordMessageLike[]>(`/channels/${settings.logChannelId}/messages?after=${after}&limit=100`)
    if (messages.length === 0) break
    // Discord liefert neueste zuerst; chronologisch verarbeiten, damit Warnungen stimmen.
    messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    for (const message of messages) {
      created += (await ingestStorageMessage(message, settings)).length
      after = message.id
    }
    fetched += messages.length
    await prisma.systemSetting.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: `${settings.logChannelId}:${after}` },
      update: { value: `${settings.logChannelId}:${after}` },
    })
    if (messages.length < 100) break
  }
  return { fetched, created }
}

let syncRunning: Promise<unknown> | null = null
export function queueStorageLogSync() {
  if (syncRunning) return syncRunning
  syncRunning = syncStorageLogChannel()
    .then((result) => { if (result.created) console.log(`[StorageLogs] ${result.created} Lagereinträge nachgeholt`) })
    // Neue oder umbenannte Agents auch ohne Knopfdruck nachträglich zuordnen.
    .then(() => relinkUnassignedStorageEntries())
    .then((linked) => { if (linked) console.log(`[StorageLogs] ${linked} Lagereinträge nachträglich Agents zugeordnet`) })
    .catch((error) => console.error('[StorageLogs] Nachholen fehlgeschlagen:', error))
    .finally(() => { syncRunning = null })
  return syncRunning
}

let workerStarted = false
/** Regelmäßiges Nachholen – falls das Gateway Nachrichten verpasst hat. */
export function ensureStorageLogWorker() {
  if (workerStarted) return
  workerStarted = true
  setTimeout(() => void queueStorageLogSync(), 30_000).unref?.()
  setInterval(() => void queueStorageLogSync(), SYNC_INTERVAL_MS).unref?.()
}

/** Zuordnung nachziehen, wenn ein Agent nachträglich angelegt oder umbenannt wurde. */
export async function relinkUnassignedStorageEntries() {
  agentIndexCache = null
  const names = await prisma.storageLogEntry.groupBy({ by: ['actorName'], where: { agentId: null } })
  let linked = 0
  for (const { actorName } of names) {
    const agentId = await agentIdForName(actorName)
    if (!agentId) continue
    const result = await prisma.storageLogEntry.updateMany({ where: { actorName, agentId: null }, data: { agentId } })
    await prisma.storageAlert.updateMany({ where: { actorName, agentId: null }, data: { agentId } })
    linked += result.count
  }
  return linked
}

/* ── Abfragen für die Seiten ─────────────────────────────────────── */

export function rangeStart(range: string | null) {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : null
  return days ? new Date(Date.now() - days * 24 * 60 * 60_000) : null
}

/** Je Agent (bzw. nicht zugeordnetem Namen) die Summen im Zeitraum. */
export async function storageSummary(since: Date | null) {
  const where = since ? { occurredAt: { gte: since } } : {}
  const [byAgent, byName, alerts] = await Promise.all([
    prisma.storageLogEntry.groupBy({
      by: ['agentId', 'direction', 'isWeapon'],
      where: { ...where, agentId: { not: null } },
      _sum: { quantity: true },
      _count: { _all: true },
      _max: { occurredAt: true },
    }),
    prisma.storageLogEntry.groupBy({
      by: ['actorName', 'direction', 'isWeapon'],
      where: { ...where, agentId: null },
      _sum: { quantity: true },
      _count: { _all: true },
      _max: { occurredAt: true },
    }),
    prisma.storageAlert.groupBy({ by: ['agentId', 'actorName'], where: since ? { createdAt: { gte: since } } : {}, _count: { _all: true } }),
  ])

  type Row = { key: string; agentId: string | null; actorName: string | null; outEntries: number; outItems: number; outWeapons: number; inItems: number; lastOut: Date | null; lastActivity: Date | null; alerts: number }
  const rows = new Map<string, Row>()
  const row = (key: string, agentId: string | null, actorName: string | null) => {
    let current = rows.get(key)
    if (!current) {
      current = { key, agentId, actorName, outEntries: 0, outItems: 0, outWeapons: 0, inItems: 0, lastOut: null, lastActivity: null, alerts: 0 }
      rows.set(key, current)
    }
    return current
  }
  const add = (target: Row, group: { direction: string; isWeapon: boolean; _sum: { quantity: number | null }; _count: { _all: number }; _max: { occurredAt: Date | null } }) => {
    const quantity = group._sum.quantity ?? 0
    const last = group._max.occurredAt
    if (group.direction === 'OUT') {
      target.outEntries += group._count._all
      target.outItems += quantity
      if (group.isWeapon) target.outWeapons += quantity
      if (last && (!target.lastOut || last > target.lastOut)) target.lastOut = last
    } else {
      target.inItems += quantity
    }
    if (last && (!target.lastActivity || last > target.lastActivity)) target.lastActivity = last
  }
  for (const group of byAgent) add(row(`agent:${group.agentId}`, group.agentId, null), group)
  for (const group of byName) add(row(`name:${group.actorName}`, null, group.actorName), group)
  for (const group of alerts) {
    const target = rows.get(group.agentId ? `agent:${group.agentId}` : `name:${group.actorName}`)
    if (target) target.alerts += group._count._all
  }

  const agentIds = [...rows.values()].map((r) => r.agentId).filter((id): id is string => Boolean(id))
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, firstName: true, lastName: true, badgeNumber: true, status: true, rank: { select: { name: true, color: true } } },
  })
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  return [...rows.values()]
    .map((r) => ({ ...r, agent: r.agentId ? agentById.get(r.agentId) ?? null : null }))
    .sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0))
}

export async function storageEntries(filter: { agentId?: string | null; actorName?: string | null; since: Date | null; direction?: 'IN' | 'OUT' | null; take?: number }) {
  return prisma.storageLogEntry.findMany({
    where: {
      ...(filter.agentId ? { agentId: filter.agentId } : {}),
      ...(filter.actorName ? { actorName: filter.actorName, agentId: null } : {}),
      ...(filter.since ? { occurredAt: { gte: filter.since } } : {}),
      ...(filter.direction ? { direction: filter.direction } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(filter.take ?? 500, 2000),
    select: { slug: true, direction: true, actorName: true, item: true, quantity: true, isWeapon: true, storage: true, occurredAt: true, agentId: true },
  })
}

/** Ein Eintrag samt allem, was dieselbe Person 30 Minuten davor und danach getan hat. */
export async function storageEntryWithContext(slug: string) {
  const entry = await prisma.storageLogEntry.findUnique({
    where: { slug },
    include: { agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, rank: { select: { name: true } } } } },
  })
  if (!entry) return null
  const window = 30 * 60_000
  const context = await prisma.storageLogEntry.findMany({
    where: {
      ...(entry.agentId ? { agentId: entry.agentId } : { actorName: entry.actorName, agentId: null }),
      occurredAt: { gte: new Date(entry.occurredAt.getTime() - window), lte: new Date(entry.occurredAt.getTime() + window) },
    },
    orderBy: { occurredAt: 'asc' },
    select: { slug: true, direction: true, item: true, quantity: true, isWeapon: true, storage: true, occurredAt: true },
  })
  const alerts = await prisma.storageAlert.findMany({
    where: { ...(entry.agentId ? { agentId: entry.agentId } : { actorName: entry.actorName }), windowEnd: { gte: entry.occurredAt }, windowStart: { lte: entry.occurredAt } },
    select: { slug: true, weaponCount: true, itemCount: true, createdAt: true },
  })
  return { entry, context, alerts }
}

export async function storageAlerts(since: Date | null, take = 50) {
  return prisma.storageAlert.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      slug: true, actorName: true, agentId: true, weaponCount: true, itemCount: true, windowStart: true, windowEnd: true, entrySlugs: true, createdAt: true,
      agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
    },
  })
}

/** Ob die Gateway-Nachricht in den Lager-Channel gehört (spart den Settings-Abruf für andere Channels). */
let channelCache: { expiresAt: number; channelId: string } | null = null
export async function isStorageLogChannel(channelId: string) {
  if (!channelCache || Date.now() > channelCache.expiresAt) {
    channelCache = { expiresAt: Date.now() + 60_000, channelId: (await getStorageSettings()).logChannelId }
  }
  return channelCache.channelId !== '' && channelCache.channelId === channelId
}

export async function storageLogsConfigured() {
  const [settings, config] = await Promise.all([getStorageSettings(), getDiscordConfig()])
  return { logChannel: Boolean(settings.logChannelId), alertChannel: Boolean(settings.alertChannelId), guild: Boolean(config.guildId) }
}

export function storageRouteError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Serverfehler'
  if (message === 'Unauthorized') return unauthorized()
  if (message === 'Forbidden') return forbidden()
  console.error('[StorageLogs]', cause)
  return error('Lagerlogs konnten nicht geladen werden', 500)
}
