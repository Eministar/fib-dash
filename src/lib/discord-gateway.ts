import { prisma } from '@/lib/prisma'
import { getDutyMode } from '@/lib/duty-mode'
import { getDiscordConfig, sendGameClockInReminder } from '@/lib/discord-integration'
import { findAgentForDiscord, getOpenDutySession } from '@/lib/manual-duty'
import { GameReminderTracker, trackedGameName, type PresenceActivity } from '@/lib/game-presence'

/**
 * Schlanker Discord-Gateway-Client, nur für Statusmeldungen (Presence).
 * Alles andere läuft weiter über REST und den Interactions-Endpoint.
 * Voraussetzung: „Presence Intent“ ist im Developer Portal aktiviert.
 */

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'
const INTENT_GUILDS = 1 << 0
const INTENT_GUILD_PRESENCES = 1 << 8
const REMINDER_COOLDOWN_MS = 60 * 60_000
const GUILD_REFRESH_MS = 10 * 60_000
/** Diese Close-Codes lassen sich durch Neuverbinden nicht beheben (Token, Intents). */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014])

type GatewayPayload = { op: number; d: unknown; s: number | null; t: string | null }
type Presence = { user?: { id?: string }; guild_id?: string; status?: string; activities?: PresenceActivity[] }

const LOG = '[DiscordGateway]'
const tracker = new GameReminderTracker(REMINDER_COOLDOWN_MS)

let socket: WebSocket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let firstHeartbeat: ReturnType<typeof setTimeout> | null = null
let heartbeatAcked = true
let sequence: number | null = null
let sessionId: string | null = null
let resumeUrl: string | null = null
let reconnectDelayMs = 1_000
let guildId = ''
let guildCheckedAt = 0

function botToken() {
  return process.env.DISCORD_BOT_TOKEN?.trim() || process.env.FIB_DISCORD_BOT_TOKEN?.trim() || ''
}

function isPlaying(presence: Presence) {
  return presence.status !== 'offline' && trackedGameName(presence.activities) !== null
}

async function refreshGuildId() {
  if (Date.now() - guildCheckedAt < GUILD_REFRESH_MS) return guildId
  guildCheckedAt = Date.now()
  guildId = (await getDiscordConfig()).guildId
  return guildId
}

async function remindIfNotClockedIn(discordId: string, gameName: string) {
  if (await getDutyMode() !== 'manual') return
  const agent = await findAgentForDiscord(discordId)
  if (!agent) return
  const now = new Date()
  const [details, absence, open] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agent.id }, select: { onLeave: true } }),
    prisma.absenceNotice.findFirst({ where: { agentId: agent.id, startsAt: { lte: now }, endsAt: { gte: now } }, select: { id: true } }),
    getOpenDutySession(agent.id),
  ])
  if (details?.onLeave || absence || open) return
  await sendGameClockInReminder({ discordId, gameName })
  console.log(`${LOG} Einstempel-Erinnerung an ${agent.firstName} ${agent.lastName} gesendet (${gameName})`)
}

async function handlePresence(presence: Presence) {
  const userId = presence.user?.id
  if (!userId) return
  const mainGuild = await refreshGuildId()
  if (mainGuild && presence.guild_id !== mainGuild) return
  if (!tracker.update(userId, isPlaying(presence))) return
  await remindIfNotClockedIn(userId, trackedGameName(presence.activities) ?? 'FiveM')
}

async function handleGuildCreate(guild: { id?: string; presences?: Presence[] }) {
  const mainGuild = await refreshGuildId()
  if (mainGuild && guild.id !== mainGuild) return
  // Wer beim Verbinden schon spielt, bekommt keine Erinnerung – sonst bei jedem Neustart.
  for (const presence of guild.presences ?? []) {
    if (presence.user?.id) tracker.seed(presence.user.id, isPlaying(presence))
  }
}

function send(payload: { op: number; d: unknown }) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (firstHeartbeat) clearTimeout(firstHeartbeat)
  heartbeatTimer = null
  firstHeartbeat = null
}

function startHeartbeat(intervalMs: number) {
  stopHeartbeat()
  heartbeatAcked = true
  const beat = () => {
    if (!heartbeatAcked) {
      // Zombie-Verbindung: kein ACK auf den letzten Heartbeat.
      socket?.close(4000, 'heartbeat timeout')
      return
    }
    heartbeatAcked = false
    send({ op: 1, d: sequence })
  }
  firstHeartbeat = setTimeout(beat, Math.floor(intervalMs * Math.random()))
  firstHeartbeat.unref?.()
  heartbeatTimer = setInterval(beat, intervalMs)
  heartbeatTimer.unref?.()
}

function identify() {
  send({
    op: 2,
    d: {
      token: botToken(),
      intents: INTENT_GUILDS | INTENT_GUILD_PRESENCES,
      properties: { os: process.platform, browser: 'fib-dashboard', device: 'fib-dashboard' },
    },
  })
}

function resume() {
  send({ op: 6, d: { token: botToken(), session_id: sessionId, seq: sequence } })
}

function forgetSession() {
  sessionId = null
  resumeUrl = null
  sequence = null
}

function scheduleReconnect() {
  const delay = reconnectDelayMs
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60_000)
  setTimeout(connect, delay).unref?.()
}

function onDispatch(type: string | null, data: unknown) {
  if (type === 'READY') {
    const ready = data as { session_id: string; resume_gateway_url: string }
    sessionId = ready.session_id
    resumeUrl = ready.resume_gateway_url
    reconnectDelayMs = 1_000
    guildCheckedAt = 0
    console.log(`${LOG} Verbunden`)
  } else if (type === 'RESUMED') {
    reconnectDelayMs = 1_000
  } else if (type === 'GUILD_CREATE') {
    void handleGuildCreate(data as { id?: string; presences?: Presence[] }).catch((error) => {
      console.error(`${LOG} GUILD_CREATE fehlgeschlagen:`, error)
    })
  } else if (type === 'PRESENCE_UPDATE') {
    void handlePresence(data as Presence).catch((error) => {
      console.error(`${LOG} Statusmeldung konnte nicht verarbeitet werden:`, error)
    })
  }
}

function connect() {
  const resuming = !!(sessionId && resumeUrl)
  const url = resuming ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY_URL
  const ws = new WebSocket(url)
  socket = ws

  ws.addEventListener('message', (event) => {
    let payload: GatewayPayload
    try {
      payload = JSON.parse(String(event.data)) as GatewayPayload
    } catch {
      return
    }
    if (payload.s !== null && payload.s !== undefined) sequence = payload.s
    switch (payload.op) {
      case 0: onDispatch(payload.t, payload.d); break
      case 1: send({ op: 1, d: sequence }); break
      case 7: ws.close(4000, 'reconnect requested'); break
      case 9:
        // Ungültige Session: nach kurzer Pause neu identifizieren (bzw. fortsetzen, falls erlaubt).
        if (!payload.d) forgetSession()
        setTimeout(() => (payload.d ? resume() : identify()), 1_000 + Math.random() * 4_000).unref?.()
        break
      case 10:
        startHeartbeat((payload.d as { heartbeat_interval: number }).heartbeat_interval)
        if (resuming) resume()
        else identify()
        break
      case 11: heartbeatAcked = true; break
    }
  })

  ws.addEventListener('close', (event) => {
    if (socket === ws) socket = null
    stopHeartbeat()
    if (FATAL_CLOSE_CODES.has(event.code)) {
      console.error(`${LOG} Verbindung dauerhaft abgelehnt (${event.code} ${event.reason}). ` +
        (event.code === 4014 ? 'Bitte im Discord Developer Portal den „Presence Intent“ aktivieren.' : 'Bot-Token prüfen.'))
      return
    }
    // Ohne Session-Resume würden wir sonst mit veraltetem Stand weitermachen.
    if (event.code === 1000 || event.code === 1001) forgetSession()
    scheduleReconnect()
  })

  ws.addEventListener('error', () => {
    // Das close-Event folgt und kümmert sich um den Neuaufbau.
  })
}

/** Startet die Gateway-Verbindung einmal pro Prozess (nur mit Bot-Token). */
export function ensureDiscordGateway() {
  const state = globalThis as typeof globalThis & { __fibDiscordGatewayStarted?: boolean }
  if (state.__fibDiscordGatewayStarted || !botToken()) return
  if (typeof WebSocket === 'undefined') {
    console.warn(`${LOG} WebSocket nicht verfügbar – Spiel-Erinnerungen deaktiviert.`)
    return
  }
  state.__fibDiscordGatewayStarted = true
  connect()
}
