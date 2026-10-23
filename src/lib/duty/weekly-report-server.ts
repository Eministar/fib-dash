import { prisma } from '@/lib/prisma'
import { getDutyRanking } from '@/lib/duty/duty-times'
import { getDiscordConfig, postChannelMessage } from '@/lib/discord/discord-integration'
import { resolveBaseUrl } from '@/lib/site'
import {
  isWeeklyReportDue,
  lastCompletedWeek,
  weeklyReportMessage,
  type WeeklyMetric,
  type WeeklyReportData,
  type WeeklyReportWindow,
} from '@/lib/duty/weekly-report'

const LAST_SENT_KEY = 'weeklyReport.lastSentWeek'
const CHECK_INTERVAL_MS = 15 * 60_000

function split<T>(rows: T[], dateOf: (row: T) => Date, window: WeeklyReportWindow): WeeklyMetric {
  let current = 0
  let previous = 0
  for (const row of rows) {
    const date = dateOf(row)
    if (date >= window.start && date < window.end) current++
    else if (date >= window.previousStart && date < window.start) previous++
  }
  return { current, previous }
}

/** Zahlen wie in der Statistik: gleiche Quellen, nur auf zwei Kalenderwochen begrenzt. */
export async function collectWeeklyReport(now = new Date()): Promise<WeeklyReportData> {
  const window = lastCompletedWeek(now)
  const range = { gte: window.previousStart, lt: window.end }

  const [hires, terminations, rankChanges, sanctions, currentAgents, duty, previousDuty] = await Promise.all([
    prisma.auditLog.findMany({ where: { action: 'AGENT_CREATED', createdAt: range }, select: { createdAt: true } }),
    prisma.termination.findMany({ where: { terminatedAt: range }, select: { terminatedAt: true } }),
    prisma.promotionLog.findMany({
      where: { createdAt: range },
      select: { createdAt: true, oldRank: { select: { sortOrder: true } }, newRank: { select: { sortOrder: true } } },
    }),
    prisma.sanction.findMany({ where: { createdAt: range }, select: { createdAt: true } }),
    prisma.agent.count({ where: { status: { not: 'TERMINATED' } } }),
    getDutyRanking(window.start, window.end, now, 3),
    getDutyRanking(window.previousStart, window.start, now, 0),
  ])

  // Kleinere Rang-Sortierung = höherer Rang (wie in der Statistik).
  const promotions = rankChanges.filter((row) => row.newRank.sortOrder < row.oldRank.sortOrder)
  const demotions = rankChanges.filter((row) => row.newRank.sortOrder > row.oldRank.sortOrder)

  return {
    window,
    hires: split(hires, (row) => row.createdAt, window),
    terminations: split(terminations, (row) => row.terminatedAt, window),
    promotions: split(promotions, (row) => row.createdAt, window),
    demotions: split(demotions, (row) => row.createdAt, window),
    sanctions: split(sanctions, (row) => row.createdAt, window),
    dutyMs: { current: duty.totalDurationMs, previous: previousDuty.totalDurationMs },
    dutyParticipants: duty.participantCount,
    topDuty: duty.rows.map((row) => ({ name: `${row.firstName} ${row.lastName}`, durationMs: row.durationMs })),
    currentAgents,
  }
}

export async function sendWeeklyReport(channelId: string, now = new Date()) {
  const data = await collectWeeklyReport(now)
  const base = resolveBaseUrl()
  await postChannelMessage(channelId, weeklyReportMessage(data, base ? `${base}/dashboard?view=statistics` : undefined))
  return data
}

/**
 * Prüft, ob der Bericht fällig ist, und sendet ihn genau einmal je Woche.
 * Die Woche wird vor dem Senden vermerkt, damit parallele Läufe nicht doppelt
 * posten; schlägt das Senden fehl, wird der Vermerk zurückgenommen.
 */
export async function runWeeklyReport(now = new Date()) {
  const config = await getDiscordConfig()
  if (!config.weeklyReportChannelId) return { sent: false as const, reason: 'Kein Channel konfiguriert' }

  const row = await prisma.systemSetting.findUnique({ where: { key: LAST_SENT_KEY } })
  const lastSent = row?.value ?? null
  if (!isWeeklyReportDue(now, lastSent)) return { sent: false as const, reason: 'Nicht fällig' }

  const { key } = lastCompletedWeek(now)
  const claimed = row
    ? (await prisma.systemSetting.updateMany({ where: { key: LAST_SENT_KEY, value: row.value }, data: { value: key } })).count === 1
    : await prisma.systemSetting.create({ data: { key: LAST_SENT_KEY, value: key } }).then(() => true, () => false)
  if (!claimed) return { sent: false as const, reason: 'Bereits von einem anderen Lauf übernommen' }

  try {
    await sendWeeklyReport(config.weeklyReportChannelId, now)
    return { sent: true as const, week: key }
  } catch (error) {
    await prisma.systemSetting.update({ where: { key: LAST_SENT_KEY }, data: { value: lastSent ?? '' } }).catch(() => undefined)
    throw error
  }
}

let workerStarted = false

export function ensureWeeklyReportWorker() {
  if (workerStarted) return
  workerStarted = true
  const tick = () => {
    void runWeeklyReport()
      .then((result) => { if (result.sent) console.log(`[WeeklyReport] Bericht für Woche ab ${result.week} gesendet`) })
      .catch((error) => console.error('[WeeklyReport] Bericht fehlgeschlagen:', error))
  }
  setTimeout(tick, 60_000).unref?.()
  setInterval(tick, CHECK_INTERVAL_MS).unref?.()
}
