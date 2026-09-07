import { prisma } from '@/lib/prisma'
import { endActiveAbsencesForAgent, runAgentStatusAutomation } from '@/lib/absence-status'

const DEFAULT_PLAYER_ONLINE_API_URL = 'https://dash.nero-v.cc/api/external/player-online'
const DEFAULT_POLICE_JOB = 'police'
const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_SYNC_TTL_MS = 30_000
const DEFAULT_CONCURRENCY = 8
const SCRIPT_GRACE_MS = 3 * 60_000   // 3 min: script-disconnect grace period
const ERROR_FALLBACK_MS = 5 * 60_000 // 5 min: reuse last-good result on transient errors

export type PlayerOnlineStatusName = 'online' | 'offline' | 'ignored-job' | 'not-linked' | 'not-configured' | 'error'

export type PlayerOnlinePlayer = {
  name: string
  identifier: string | null
  steamId: string | null
  job: string | null
  ping: number | null
  playtimeSeconds: number | null
  connectedAt: Date | null
}

export type PlayerOnlineSyncResult = {
  agentId: string
  discordId: string | null
  status: PlayerOnlineStatusName
  online: boolean
  scriptConnected: boolean
  lastHeartbeat: Date | null
  player: PlayerOnlinePlayer | null
  endedAbsences: number
  error?: string
}

export type PlayerOnlineSyncSummary = {
  configured: boolean
  checkedAt: Date
  onlineCount: number
  errorCount: number
  statusCounts: Record<PlayerOnlineStatusName, number>
  errorSummary: Array<{ message: string; count: number }>
  results: PlayerOnlineSyncResult[]
}

type AgentForPlayerSync = {
  id: string
  discordId: string | null
}

type RawPlayerOnlineResponse = {
  discordId?: unknown
  discord_id?: unknown
  online?: unknown
  isOnline?: unknown
  is_online?: unknown
  scriptConnected?: unknown
  script_connected?: unknown
  lastHeartbeat?: unknown
  last_heartbeat?: unknown
  player?: unknown
}

type RawPlayer = {
  name?: unknown
  playerName?: unknown
  player_name?: unknown
  identifier?: unknown
  license?: unknown
  steamId?: unknown
  steam_id?: unknown
  job?: unknown
  ping?: unknown
  playtimeSeconds?: unknown
  playtime_seconds?: unknown
  connectedAt?: unknown
  connected_at?: unknown
}

type UnknownRecord = Record<string, unknown>

let lastAllSyncAt = 0
let lastAllSync: PlayerOnlineSyncSummary | null = null
let activeAllSync: Promise<PlayerOnlineSyncSummary> | null = null

// Per-agent cache: keeps last successful fetch result for error fallback and grace period
const agentResultCache = new Map<string, { result: PlayerOnlineSyncResult; at: number }>()

function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

function envNumber(names: string[], fallback: number) {
  const value = envValue(...names)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function playerOnlineApiSecret() {
  return envValue('PLAYER_ONLINE_API_SECRET', 'FIB_PLAYER_ONLINE_API_SECRET', 'NEROV_PLAYER_ONLINE_API_SECRET')
}

function playerOnlineApiUrl() {
  const raw = envValue('PLAYER_ONLINE_API_URL', 'FIB_PLAYER_ONLINE_API_URL', 'NEROV_PLAYER_ONLINE_API_URL') || DEFAULT_PLAYER_ONLINE_API_URL
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function policeJob() {
  return (envValue('PLAYER_ONLINE_POLICE_JOB', 'FIB_PLAYER_ONLINE_POLICE_JOB') || DEFAULT_POLICE_JOB).toLowerCase()
}

function playerOnlineTimeoutMs() {
  return envNumber(['PLAYER_ONLINE_API_TIMEOUT_MS', 'FIB_PLAYER_ONLINE_API_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS)
}

function syncTtlMs() {
  return envNumber(['PLAYER_ONLINE_SYNC_TTL_MS', 'FIB_PLAYER_ONLINE_SYNC_TTL_MS'], DEFAULT_SYNC_TTL_MS)
}

function syncConcurrency() {
  return Math.min(envNumber(['PLAYER_ONLINE_SYNC_CONCURRENCY', 'FIB_PLAYER_ONLINE_SYNC_CONCURRENCY'], DEFAULT_CONCURRENCY), 20)
}

export function playerOnlineApiConfigured() {
  return !!playerOnlineApiSecret()
}

function cleanDiscordId(value: unknown) {
  if (typeof value !== 'string') return null
  const id = value.replace(/^discord:/i, '').trim()
  return /^\d{17,22}$/.test(id) ? id : null
}

function cleanString(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function firstValue(record: UnknownRecord, names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined) return record[name]
  }
  return undefined
}

function cleanBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'online', 'connected'].includes(normalized)) return true
  if (['false', '0', 'no', 'offline', 'disconnected'].includes(normalized)) return false
  return null
}

function cleanInt(value: unknown) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  if (!Number.isFinite(numeric)) return null
  const int = Math.round(numeric)
  return int >= 0 ? int : null
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && !value.trim()) return null
  const numeric = typeof value === 'number' ? value : Number.NaN
  const date = new Date(Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cleanJob(value: unknown) {
  if (typeof value === 'string') return cleanString(value, 64)
  const record = asRecord(value)
  if (!record) return null
  return cleanString(firstValue(record, ['name', 'id', 'key', 'label']), 64)
}

function normalizePlayer(value: unknown): PlayerOnlinePlayer | null {
  const record = asRecord(value)
  if (!record) return null
  const player = record as RawPlayer
  const name = cleanString(firstValue(record, ['name', 'playerName', 'player_name', 'displayName']), 80)
  if (!name) return null

  return {
    name,
    identifier: cleanString(firstValue(record, ['identifier', 'license', 'licenseId', 'license_id']), 96),
    steamId: cleanString(firstValue(record, ['steamId', 'steam_id', 'steam']), 64),
    job: cleanJob(player.job),
    ping: cleanInt(player.ping),
    playtimeSeconds: cleanInt(firstValue(record, ['playtimeSeconds', 'playtime_seconds', 'playtime'])),
    connectedAt: cleanDate(firstValue(record, ['connectedAt', 'connected_at', 'joinedAt', 'joined_at'])),
  }
}

function isPolicePlayer(player: PlayerOnlinePlayer | null) {
  return (player?.job ?? '').trim().toLowerCase() === policeJob()
}

function sessionStartFromPlayer(player: PlayerOnlinePlayer, now: Date) {
  if (player.connectedAt) return player.connectedAt
  if (player.playtimeSeconds && player.playtimeSeconds > 0) {
    return new Date(now.getTime() - player.playtimeSeconds * 1000)
  }
  return now
}

function sessionEndFromStatus(status: { lastHeartbeat: Date | null }, now: Date) {
  if (status.lastHeartbeat && status.lastHeartbeat.getTime() <= now.getTime()) return status.lastHeartbeat
  return now
}

function responseRecord(value: unknown) {
  const root = asRecord(value)
  if (!root) return null
  const statusFields = ['online', 'isOnline', 'is_online', 'scriptConnected', 'script_connected', 'connected', 'player', 'character', 'playerData', 'player_data']
  if (statusFields.some((field) => root[field] !== undefined)) return root
  for (const key of ['data', 'result', 'response']) {
    const nested = asRecord(root[key])
    if (nested) return nested
  }
  return root
}

function playerList(value: unknown) {
  if (Array.isArray(value)) return value.map(asRecord).filter((row): row is UnknownRecord => !!row)
  const root = asRecord(value)
  if (!root) return null
  for (const key of ['players', 'data', 'results']) {
    if (Array.isArray(root[key])) {
      return (root[key] as unknown[]).map(asRecord).filter((row): row is UnknownRecord => !!row)
    }
    const nested = asRecord(root[key])
    if (nested) {
      for (const nestedKey of ['players', 'data', 'results']) {
        if (Array.isArray(nested[nestedKey])) {
          return (nested[nestedKey] as unknown[]).map(asRecord).filter((row): row is UnknownRecord => !!row)
        }
      }
    }
  }
  return null
}

function normalizePlayerOnlineResponse(value: unknown, requestedDiscordId: string) {
  const list = playerList(value)
  if (list) {
    const match = list.find((row) => {
      const directId = cleanDiscordId(firstValue(row, ['discordId', 'discord_id', 'discord']))
      const identifiers = Array.isArray(row.identifiers) ? row.identifiers : []
      const identifierId = identifiers.map(cleanDiscordId).find(Boolean) ?? null
      return (directId ?? identifierId) === requestedDiscordId
    })
    if (!match) {
      return {
        discordId: requestedDiscordId,
        online: false,
        scriptConnected: false,
        lastHeartbeat: null,
        player: null,
      }
    }
    const explicitPlayer = firstValue(match, ['player', 'character'])
    const player = normalizePlayer(explicitPlayer ?? match)
    return {
      discordId: cleanDiscordId(firstValue(match, ['discordId', 'discord_id', 'discord'])) ?? requestedDiscordId,
      online: cleanBoolean(firstValue(match, ['online', 'isOnline', 'is_online'])) ?? true,
      scriptConnected: cleanBoolean(firstValue(match, ['scriptConnected', 'script_connected', 'isScriptConnected', 'connected'])) ?? true,
      lastHeartbeat: cleanDate(firstValue(match, ['lastHeartbeat', 'last_heartbeat', 'heartbeatAt', 'heartbeat_at'])),
      player,
    }
  }

  const record = responseRecord(value)
  if (!record) throw new Error('Player-Online API lieferte kein JSON-Objekt')
  const playerValue = firstValue(record, ['player', 'character', 'playerData', 'player_data'])
  const player = normalizePlayer(playerValue) ?? normalizePlayer(record)
  const onlineValue = firstValue(record, ['online', 'isOnline', 'is_online'])
  const connectedValue = firstValue(record, ['scriptConnected', 'script_connected', 'isScriptConnected', 'connected'])
  const online = cleanBoolean(onlineValue)
  const scriptConnected = cleanBoolean(connectedValue)

  if (online === null && scriptConnected === null && !player) {
    const fields = Object.keys(record).slice(0, 12).join(', ') || 'keine'
    throw new Error(`Unbekanntes Player-Online-Antwortformat (Felder: ${fields})`)
  }

  return {
    discordId: cleanDiscordId(firstValue(record, ['discordId', 'discord_id', 'discord'])) ?? requestedDiscordId,
    online: online ?? !!player,
    scriptConnected: scriptConnected ?? (online ?? !!player),
    lastHeartbeat: cleanDate(firstValue(record, ['lastHeartbeat', 'last_heartbeat', 'heartbeatAt', 'heartbeat_at'])),
    player,
  }
}

function countStatuses(results: PlayerOnlineSyncResult[]) {
  const counts: Record<PlayerOnlineStatusName, number> = {
    online: 0,
    offline: 0,
    'ignored-job': 0,
    'not-linked': 0,
    'not-configured': 0,
    error: 0,
  }
  results.forEach((result) => { counts[result.status] += 1 })
  return counts
}

function summarizeErrors(results: PlayerOnlineSyncResult[]) {
  const counts = new Map<string, number>()
  results.forEach((result) => {
    if (result.status !== 'error') return
    const message = (result.error?.trim() || 'Unbekannter Player-Online-Fehler').slice(0, 220)
    counts.set(message, (counts.get(message) ?? 0) + 1)
  })
  return Array.from(counts, ([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
    .slice(0, 4)
}

async function responseErrorDetail(res: Response) {
  const text = await res.text().catch(() => '')
  if (!text) return ''

  const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(text) as UnknownRecord
      const detail = cleanString(firstValue(body, ['error', 'message', 'detail']), 160)
      if (detail) return detail
    } catch {
      // Ungültiges JSON wird unten als bereinigter Text ausgegeben.
    }
  }

  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

async function fetchPlayerOnline(discordId: string): Promise<{
  discordId: string
  online: boolean
  scriptConnected: boolean
  lastHeartbeat: Date | null
  player: PlayerOnlinePlayer | null
  treatAsOffline?: boolean
}> {
  const secret = playerOnlineApiSecret()
  if (!secret) throw new Error('Player-Online API-Secret fehlt')

  const url = new URL(playerOnlineApiUrl())
  url.searchParams.set('discordId', discordId)

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-secret': secret, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(playerOnlineTimeoutMs()),
  })

  if (res.status === 401) {
    const detail = await responseErrorDetail(res)
    throw new Error(`Player-Online API-Secret fehlt oder ist ungültig (401)${detail ? `: ${detail}` : ''}`)
  }

  if (res.status === 403) {
    const detail = await responseErrorDetail(res)
    throw new Error(`Player-Online API verbietet die Anfrage (403)${detail ? `: ${detail}` : ''}. Secret-Berechtigung, Server-IP und Cloudflare prüfen.`)
  }

  if (res.status === 404) {
    return {
      discordId,
      online: false,
      scriptConnected: false,
      lastHeartbeat: null,
      player: null,
      treatAsOffline: true,
    }
  }

  if (!res.ok) {
    const detail = await responseErrorDetail(res)
    throw new Error(`Player-Online API ${res.status}: ${detail || res.statusText}`)
  }

  const body = await res.json() as RawPlayerOnlineResponse
  return normalizePlayerOnlineResponse(body, discordId)
}

async function endActivePlaytime(agent: AgentForPlayerSync, endedAt: Date) {
  // Capture lastSeenAt BEFORE updating so we store the real last-seen timestamp,
  // not "now" (endedAt may just be the current sync time).
  const activeSessions = await prisma.playtimeSession.findMany({
    where: {
      endedAt: null,
      OR: [
        { agentId: agent.id },
        ...(agent.discordId ? [{ discordId: agent.discordId }] : []),
      ],
    },
    select: { id: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  })

  if (activeSessions.length === 0) return

  await prisma.playtimeSession.updateMany({
    where: { id: { in: activeSessions.map((s) => s.id) } },
    data: { endedAt, lastSeenAt: endedAt },
  })

  // Use the session's pre-update lastSeenAt as the agent's last online time
  await prisma.agent.update({
    where: { id: agent.id },
    data: { lastOnline: activeSessions[0].lastSeenAt },
  })
}

async function upsertActivePlaytime(agent: AgentForPlayerSync, player: PlayerOnlinePlayer, lastSeenAt: Date, now: Date) {
  const startedAt = sessionStartFromPlayer(player, now)
  const active = await prisma.playtimeSession.findFirst({
    where: {
      endedAt: null,
      OR: [
        { agentId: agent.id },
        ...(agent.discordId ? [{ discordId: agent.discordId }] : []),
      ],
    },
    orderBy: { startedAt: 'desc' },
  })

  if (active) {
    const earliestStart = startedAt.getTime() < active.startedAt.getTime() ? startedAt : active.startedAt
    return prisma.playtimeSession.update({
      where: { id: active.id },
      data: {
        agentId: agent.id,
        discordId: agent.discordId,
        license: player.identifier,
        playerName: player.name,
        startedAt: earliestStart,
        lastSeenAt,
      },
    })
  }

  return prisma.playtimeSession.create({
    data: {
      agentId: agent.id,
      discordId: agent.discordId,
      license: player.identifier,
      playerName: player.name,
      startedAt,
      lastSeenAt,
    },
  })
}

async function syncOneAgentPlaytime(agent: AgentForPlayerSync, now: Date): Promise<PlayerOnlineSyncResult> {
  if (!agent.discordId) {
    return {
      agentId: agent.id,
      discordId: null,
      status: 'not-linked',
      online: false,
      scriptConnected: false,
      lastHeartbeat: null,
      player: null,
      endedAbsences: 0,
    }
  }

  try {
    const status = await fetchPlayerOnline(agent.discordId)

    // Script temporarily disconnected but player is still online with a recent heartbeat:
    // hold the grace period to avoid ending the session for a momentary hiccup.
    const scriptDisconnectedGrace = status.online && !status.scriptConnected &&
      status.lastHeartbeat !== null &&
      now.getTime() - status.lastHeartbeat.getTime() < SCRIPT_GRACE_MS

    const activePolice = status.online && status.scriptConnected && isPolicePlayer(status.player)

    if (!activePolice || !status.player) {
      if (scriptDisconnectedGrace) {
        const cached = agentResultCache.get(agent.id)
        const hasActiveSession = cached?.result.status === 'online'
          ? true
          : !!(await prisma.playtimeSession.findFirst({
            where: {
              endedAt: null,
              OR: [
                { agentId: agent.id },
                ...(agent.discordId ? [{ discordId: agent.discordId }] : []),
              ],
            },
            select: { id: true },
          }))
        // Keep the live view stable during short script disconnects. The session
        // still ends below if the grace period expires or the API reports offline.
        const result: PlayerOnlineSyncResult = {
          agentId: agent.id,
          discordId: agent.discordId,
          status: hasActiveSession ? 'online' : 'offline',
          online: hasActiveSession,
          scriptConnected: false,
          lastHeartbeat: status.lastHeartbeat,
          player: cached?.result.player ?? null,
          endedAbsences: 0,
        }
        agentResultCache.set(agent.id, { result, at: now.getTime() })
        return result
      }

      const sessionEnd = sessionEndFromStatus(status, now)
      await endActivePlaytime(agent, sessionEnd)
      const result: PlayerOnlineSyncResult = {
        agentId: agent.id,
        discordId: agent.discordId,
        status: status.online && status.scriptConnected ? 'ignored-job' : 'offline',
        online: status.online,
        scriptConnected: status.scriptConnected,
        lastHeartbeat: status.lastHeartbeat,
        player: status.player,
        endedAbsences: 0,
      }
      agentResultCache.set(agent.id, { result, at: now.getTime() })
      return result
    }

    const lastSeenAt = status.lastHeartbeat ?? now
    await upsertActivePlaytime(agent, status.player, lastSeenAt, now)
    // Don't touch lastOnline while the agent is actively playing — the session
    // tracks the current activity. lastOnline is only written when the session ends.
    const endedAbsences = await endActiveAbsencesForAgent(agent.id, now)

    const result: PlayerOnlineSyncResult = {
      agentId: agent.id,
      discordId: agent.discordId,
      status: 'online',
      online: true,
      scriptConnected: true,
      lastHeartbeat: status.lastHeartbeat,
      player: status.player,
      endedAbsences,
    }
    agentResultCache.set(agent.id, { result, at: now.getTime() })
    return result
  } catch (fetchError) {
    // On transient API errors, reuse the last known result if it's fresh enough
    const cached = agentResultCache.get(agent.id)
    if (cached && now.getTime() - cached.at < ERROR_FALLBACK_MS) {
      return cached.result
    }

    return {
      agentId: agent.id,
      discordId: agent.discordId,
      status: 'error',
      online: false,
      scriptConnected: false,
      lastHeartbeat: null,
      player: null,
      endedAbsences: 0,
      error: fetchError instanceof Error ? fetchError.message : 'Player-Online API nicht erreichbar',
    }
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = []
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function syncAllPlayerPlaytime(options?: { force?: boolean; now?: Date }): Promise<PlayerOnlineSyncSummary> {
  const now = options?.now ?? new Date()

  if (!playerOnlineApiConfigured()) {
    return {
      configured: false,
      checkedAt: now,
      onlineCount: 0,
      errorCount: 0,
      statusCounts: countStatuses([]),
      errorSummary: [],
      results: [],
    }
  }

  if (!options?.force && lastAllSync && Date.now() - lastAllSyncAt < syncTtlMs()) {
    return lastAllSync
  }

  if (!options?.force && activeAllSync) return activeAllSync

  activeAllSync = (async () => {
    const agents = await prisma.agent.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: { id: true, discordId: true },
      orderBy: { badgeNumber: 'asc' },
    })
    const results = await mapWithConcurrency(agents, syncConcurrency(), (agent) => syncOneAgentPlaytime(agent, now))
    const summary = {
      configured: true,
      checkedAt: now,
      onlineCount: results.filter((result) => result.status === 'online').length,
      errorCount: results.filter((result) => result.status === 'error').length,
      statusCounts: countStatuses(results),
      errorSummary: summarizeErrors(results),
      results,
    }

    if (summary.errorSummary.length > 0) {
      console.warn(
        `[PlayerOnline] ${summary.errorCount} Fehler: ${summary.errorSummary.map((entry) => `${entry.count}× ${entry.message}`).join(' | ')}`,
      )
    }

    if (results.some((result) => result.status === 'online' || result.status === 'offline' || result.status === 'ignored-job')) {
      await runAgentStatusAutomation({ force: true })
    }

    lastAllSync = summary
    lastAllSyncAt = Date.now()
    return summary
  })()

  try {
    return await activeAllSync
  } finally {
    activeAllSync = null
  }
}

/**
 * Liefert das zuletzt erfolgreich berechnete Sync-Ergebnis OHNE einen neuen
 * externen API-Call auszulösen. Wird von häufig gepollten Endpoints (Dashboard-
 * Stats) genutzt, damit diese nicht auf die externe Player-Online
 * API warten (Ursache für 524-Timeouts).
 */
export function getLastPlayerSyncSummary(now = new Date()): PlayerOnlineSyncSummary {
  if (lastAllSync) return lastAllSync
  return {
    configured: playerOnlineApiConfigured(),
    checkedAt: now,
    onlineCount: 0,
    errorCount: 0,
    statusCounts: countStatuses([]),
    errorSummary: [],
    results: [],
  }
}

/**
 * Stößt den Player-Online-Sync im Hintergrund an (fire-and-forget), ohne auf das
 * Ergebnis zu warten. TTL- und In-Flight-Deduplizierung greifen weiterhin, sodass
 * parallele Aufrufe nur einen tatsächlichen Sync auslösen. So bleibt der Cache für
 * `getLastPlayerSyncSummary` warm, ohne den Request-Pfad zu blockieren.
 */
export function triggerPlayerPlaytimeSync(options?: { now?: Date }) {
  if (!playerOnlineApiConfigured()) return
  if (lastAllSync && Date.now() - lastAllSyncAt < syncTtlMs()) return
  if (activeAllSync) return
  void syncAllPlayerPlaytime(options).catch((error) => {
    console.error('[PlayerOnline] Hintergrund-Sync fehlgeschlagen:', error)
  })
}

export async function syncAgentPlayerPlaytime(agentId: string, options?: { now?: Date }) {
  const now = options?.now ?? new Date()
  if (!playerOnlineApiConfigured()) return null

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, status: { not: 'TERMINATED' } },
    select: { id: true, discordId: true },
  })
  if (!agent) return null

  const result = await syncOneAgentPlaytime(agent, now)
  if (result.status !== 'error') await runAgentStatusAutomation({ force: true })
  return result
}
