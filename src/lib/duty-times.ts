import { prisma } from '@/lib/prisma'
import {
  getLastPlayerSyncSummary,
  syncAllPlayerPlaytime,
  syncAgentPlayerPlaytime,
  triggerPlayerPlaytimeSync,
  type PlayerOnlinePlayer,
  type PlayerOnlineStatusName,
  type PlayerOnlineSyncResult,
} from '@/lib/player-online'

const MS_PER_MINUTE = 60_000

type DurationSession = {
  clockInAt: Date
  clockOutAt: Date | null
}

type PlaytimeSessionRow = {
  id: string
  startedAt: Date
  endedAt: Date | null
  lastSeenAt: Date
  playerName: string
  license: string | null
}

type CurrentPlayer = PlayerOnlinePlayer & {
  source: 'api' | 'session'
}

export function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / MS_PER_MINUTE))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

export function startOfCurrentWeek(date = new Date()) {
  const start = new Date(date)
  const day = start.getDay()
  const diff = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diff)
  start.setHours(0, 0, 0, 0)
  return start
}

export function endOfWeek(weekStart: Date) {
  // Über Kalendertage rechnen statt über Millisekunden: bei der Zeitumstellung
  // hat eine Woche 167 bzw. 169 Stunden. Mit `+ 7 * MS_PER_DAY` läge das
  // Wochenende in diesen beiden Wochen im Jahr eine Stunde daneben, wodurch
  // Dienstzeiten am Rand der falschen Woche zugeordnet würden.
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 7)
  end.setHours(0, 0, 0, 0)
  return end
}

export function sessionDurationMs(session: DurationSession, now = new Date()) {
  const end = session.clockOutAt ?? now
  return Math.max(0, end.getTime() - session.clockInAt.getTime())
}

export function clippedSessionDurationMs(session: DurationSession, start: Date, end: Date, now = new Date()) {
  const sessionEnd = session.clockOutAt ?? now
  const clippedStart = Math.max(session.clockInAt.getTime(), start.getTime())
  const clippedEnd = Math.min(sessionEnd.getTime(), end.getTime())
  return Math.max(0, clippedEnd - clippedStart)
}

function playtimeDurationMs(session: PlaytimeSessionRow, now = new Date()) {
  return sessionDurationMs({ clockInAt: session.startedAt, clockOutAt: session.endedAt }, now)
}

function clippedPlaytimeDurationMs(session: PlaytimeSessionRow, start: Date, end: Date, now = new Date()) {
  return clippedSessionDurationMs({ clockInAt: session.startedAt, clockOutAt: session.endedAt }, start, end, now)
}

function latestDate(dates: Array<Date | null | undefined>) {
  const timestamps = dates
    .filter((date): date is Date => !!date)
    .map((date) => date.getTime())
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps))
}

/** Kalendertag-genauer Versatz — anders als `+ n * MS_PER_DAY` auch über die Zeitumstellung hinweg korrekt. */
function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  result.setHours(0, 0, 0, 0)
  return result
}

function dailyPlaytime(sessions: PlaytimeSessionRow[], weekStart: Date, now: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    // Tagesgrenzen über den Kalender bestimmen: an den Umstellungstagen hat ein
    // Tag 23 bzw. 25 Stunden, sonst rutschen die Balken um eine Stunde und die
    // Wochentags-Beschriftung passt nicht mehr zum gezeigten Zeitraum.
    const start = addDays(weekStart, index)
    const end = addDays(weekStart, index + 1)
    const durationMs = sessions.reduce((total, session) => (
      total + clippedPlaytimeDurationMs(session, start, end, now)
    ), 0)
    return {
      date: start,
      label: new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' }).format(start),
      durationMs,
      durationLabel: formatDuration(durationMs),
    }
  })
}

type AllTimeTotalRow = {
  agentId: string
  totalSeconds: bigint | number | null
}

async function getAllTimePlaytimeTotals(now: Date) {
  const rows = await prisma.$queryRaw<AllTimeTotalRow[]>`
    SELECT agentId,
           CAST(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, startedAt, COALESCE(endedAt, ${now})))) AS SIGNED) AS totalSeconds
    FROM PlaytimeSession
    WHERE agentId IS NOT NULL
    GROUP BY agentId
  `
  return new Map(rows.map((row) => [row.agentId, Number(row.totalSeconds ?? 0) * 1000]))
}

async function getAgentAllTimePlaytimeMs(agentId: string, now: Date) {
  const rows = await prisma.$queryRaw<AllTimeTotalRow[]>`
    SELECT agentId,
           CAST(SUM(GREATEST(0, TIMESTAMPDIFF(SECOND, startedAt, COALESCE(endedAt, ${now})))) AS SIGNED) AS totalSeconds
    FROM PlaytimeSession
    WHERE agentId = ${agentId}
    GROUP BY agentId
  `
  return Number(rows[0]?.totalSeconds ?? 0) * 1000
}

function currentPlayerFromSession(session: PlaytimeSessionRow | null, live: PlayerOnlineSyncResult | undefined): CurrentPlayer | null {
  if (live?.player) return { ...live.player, source: 'api' }
  if (!session) return null
  return {
    source: 'session',
    name: session.playerName,
    identifier: session.license,
    steamId: null,
    job: null,
    ping: null,
    playtimeSeconds: null,
    connectedAt: session.startedAt,
  }
}

function aggregatePlaytime(sessions: PlaytimeSessionRow[], weekStart: Date, weekEnd: Date, now: Date) {
  const weekDurationMs = sessions.reduce((total, session) => (
    total + clippedPlaytimeDurationMs(session, weekStart, weekEnd, now)
  ), 0)
  const durations = sessions.map((session) => playtimeDurationMs(session, now))
  const sessionCount = sessions.length
  const longestSessionMs = durations.length > 0 ? Math.max(...durations) : 0
  const averageSessionMs = sessionCount > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / sessionCount) : 0

  return {
    weekDurationMs,
    sessionCount,
    longestSessionMs,
    averageSessionMs,
    daily: dailyPlaytime(sessions, weekStart, now),
    lastSeenAt: latestDate(sessions.map((session) => session.lastSeenAt)),
  }
}

export async function getDutyTimesSnapshot(now = new Date(), options?: { sync?: boolean }) {
  // sync === false: nicht auf die externe Player-Online API warten. Stattdessen das
  // zuletzt gecachte Ergebnis verwenden und den Sync im Hintergrund anstoßen. Das
  // verhindert 524-Timeouts auf häufig gepollten Endpoints (Dashboard-Stats,
  // Dashboard), die früher pro Agent einen HTTP-Call abgewartet haben.
  let sync: Awaited<ReturnType<typeof syncAllPlayerPlaytime>>
  if (options?.sync === false) {
    triggerPlayerPlaytimeSync({ now })
    sync = getLastPlayerSyncSummary(now)
  } else {
    sync = await syncAllPlayerPlaytime({ now })
  }
  const weekStart = startOfCurrentWeek(now)
  const weekEnd = endOfWeek(weekStart)
  const statusByAgentId = new Map(sync.results.map((result) => [result.agentId, result]))
  const allTimeTotals = await getAllTimePlaytimeTotals(now)

  const agents = await prisma.agent.findMany({
    where: { status: { not: 'TERMINATED' } },
    select: {
      id: true,
      badgeNumber: true,
      firstName: true,
      lastName: true,
      discordId: true,
      status: true,
      lastOnline: true,
      rank: { select: { name: true, color: true, sortOrder: true } },
      playtimeSessions: {
        where: {
          startedAt: { lt: weekEnd },
          OR: [
            { endedAt: null },
            { endedAt: { gte: weekStart } },
          ],
        },
        orderBy: { startedAt: 'desc' },
      },
    },
    orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
  })

  const rows = agents.map((agent) => {
    const live = statusByAgentId.get(agent.id)
    const activePlaySession = agent.playtimeSessions.find((session) => !session.endedAt) ?? null
    const currentDurationMs = activePlaySession ? playtimeDurationMs(activePlaySession, now) : 0
    const stats = aggregatePlaytime(agent.playtimeSessions, weekStart, weekEnd, now)
    const currentPlayer = currentPlayerFromSession(activePlaySession, live)
    const apiStatus: PlayerOnlineStatusName = !sync.configured
      ? 'not-configured'
      : live?.status ?? (agent.discordId ? 'offline' : 'not-linked')

    return {
      id: agent.id,
      badgeNumber: agent.badgeNumber,
      firstName: agent.firstName,
      lastName: agent.lastName,
      discordId: agent.discordId,
      status: agent.status,
      rank: agent.rank,
      activeSession: activePlaySession
        ? {
          id: activePlaySession.id,
          clockInAt: activePlaySession.startedAt,
          currentDurationMs,
        }
        : null,
      activePlaySession: activePlaySession
        ? {
          id: activePlaySession.id,
          startedAt: activePlaySession.startedAt,
          currentDurationMs,
          playerName: activePlaySession.playerName,
          license: activePlaySession.license,
          lastSeenAt: activePlaySession.lastSeenAt,
        }
        : null,
      currentPlayer,
      online: apiStatus === 'online',
      scriptConnected: live?.scriptConnected ?? !!activePlaySession,
      lastHeartbeat: live?.lastHeartbeat ?? activePlaySession?.lastSeenAt ?? null,
      apiStatus,
      apiError: live?.error,
      weekDurationMs: stats.weekDurationMs,
      playtimeWeekDurationMs: stats.weekDurationMs,
      totalDurationMs: allTimeTotals.get(agent.id) ?? 0,
      sessionCount: stats.sessionCount,
      averageSessionMs: stats.averageSessionMs,
      longestSessionMs: stats.longestSessionMs,
      lastSeenAt: live?.status === 'online'
        ? latestDate([live.lastHeartbeat, activePlaySession?.lastSeenAt, stats.lastSeenAt, agent.lastOnline])
        : latestDate([activePlaySession?.lastSeenAt, stats.lastSeenAt, agent.lastOnline]),
      daily: stats.daily,
    }
  })

  const activeRows = rows.filter((row) => row.apiStatus === 'online' && row.activePlaySession)
  const totalActiveDurationMs = activeRows.reduce((total, row) => total + (row.activePlaySession?.currentDurationMs ?? 0), 0)
  const totalWeekDurationMs = rows.reduce((total, row) => total + row.weekDurationMs, 0)
  const totalAllTimeDurationMs = rows.reduce((total, row) => total + row.totalDurationMs, 0)
  const totalSessionCount = rows.reduce((total, row) => total + row.sessionCount, 0)
  const longestSessionMs = rows.reduce((max, row) => Math.max(max, row.longestSessionMs), 0)
  const topRows = [...rows]
    .sort((a, b) => b.weekDurationMs - a.weekDurationMs)
    .slice(0, 8)

  return {
    now,
    weekStart,
    weekEnd,
    sync,
    activeCount: activeRows.length,
    totalActiveDurationMs,
    totalWeekDurationMs,
    totalPlaytimeWeekDurationMs: totalWeekDurationMs,
    totalAllTimeDurationMs,
    totalSessionCount,
    averageSessionMs: totalSessionCount > 0 ? Math.round(totalWeekDurationMs / totalSessionCount) : 0,
    longestSessionMs,
    rows,
    activeRows,
    topRows,
  }
}

export async function getAgentDutyTime(agentId: string, options?: { now?: Date; sync?: boolean }) {
  const now = options?.now ?? new Date()
  if (options?.sync !== false) await syncAgentPlayerPlaytime(agentId, { now })
  const weekStart = startOfCurrentWeek(now)
  const weekEnd = endOfWeek(weekStart)

  const playtimeSessions = await prisma.playtimeSession.findMany({
    where: {
      agentId,
      startedAt: { lt: weekEnd },
      OR: [
        { endedAt: null },
        { endedAt: { gte: weekStart } },
      ],
    },
    orderBy: { startedAt: 'desc' },
  })
  const activePlaySession = playtimeSessions.find((session) => !session.endedAt) ?? null
  const currentDurationMs = activePlaySession ? playtimeDurationMs(activePlaySession, now) : 0
  const stats = aggregatePlaytime(playtimeSessions, weekStart, weekEnd, now)
  const totalDurationMs = await getAgentAllTimePlaytimeMs(agentId, now)

  return {
    activeSession: activePlaySession
      ? {
        id: activePlaySession.id,
        clockInAt: activePlaySession.startedAt,
        currentDurationMs,
      }
      : null,
    activePlaySession: activePlaySession
      ? {
        id: activePlaySession.id,
        startedAt: activePlaySession.startedAt,
        currentDurationMs,
        playerName: activePlaySession.playerName,
        license: activePlaySession.license,
        lastSeenAt: activePlaySession.lastSeenAt,
      }
      : null,
    weekDurationMs: stats.weekDurationMs,
    playtimeWeekDurationMs: stats.weekDurationMs,
    totalDurationMs,
    sessionCount: stats.sessionCount,
    averageSessionMs: stats.averageSessionMs,
    longestSessionMs: stats.longestSessionMs,
    lastSeenAt: stats.lastSeenAt,
  }
}

export async function getAgentPlaytimeReport(agentId: string, options?: { now?: Date; sync?: boolean }) {
  const now = options?.now ?? new Date()
  if (options?.sync !== false) await syncAgentPlayerPlaytime(agentId, { now })
  const weekStart = startOfCurrentWeek(now)
  const weekEnd = endOfWeek(weekStart)
  const chartStart = addDays(weekStart, -6)

  const sessions = await prisma.playtimeSession.findMany({
    where: {
      agentId,
      startedAt: { lt: weekEnd },
      OR: [
        { endedAt: null },
        { endedAt: { gte: chartStart } },
      ],
    },
    orderBy: { startedAt: 'desc' },
    take: 80,
  })

  const recentSessions = sessions.slice(0, 12).map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastSeenAt: session.lastSeenAt,
    playerName: session.playerName,
    license: session.license,
    durationMs: playtimeDurationMs(session, now),
  }))

  return {
    recentSessions,
    daily: dailyPlaytime(sessions, weekStart, now),
  }
}
