/**
 * Wöchentlicher Bericht an die Leitung. Reine Logik – Zeitfenster, Vergleich
 * und Nachrichtentext –, damit sie ohne Datenbank und Discord testbar bleibt.
 */
import { actionRow, componentMessage, linkButton, markdownHeader, markdownMeta, markdownRows, separator, textDisplay } from '@/lib/discord/discord-components'

/** Ab dieser Stunde (Serverzeit) am Montag wird gesendet. */
export const WEEKLY_REPORT_HOUR = 8

export type WeeklyReportWindow = {
  /** Montag 00:00 der berichteten Woche. */
  start: Date
  /** Montag 00:00 der laufenden Woche (exklusiv). */
  end: Date
  /** Montag 00:00 der Vergleichswoche. */
  previousStart: Date
  /** Eindeutiger Schlüssel der berichteten Woche, z. B. "2026-10-12". */
  key: string
}

// Bewusst ohne Import aus duty-times: das zieht den Prisma-Client mit.
function startOfCurrentWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day))
  start.setHours(0, 0, 0, 0)
  return start
}

/** „12h 05m“ – gleiche Schreibweise wie im Dienstzeiten-Bereich. */
export function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function previousMonday(monday: Date) {
  const result = new Date(monday)
  result.setDate(result.getDate() - 7)
  result.setHours(0, 0, 0, 0)
  return result
}

/** Die zuletzt abgeschlossene Kalenderwoche (Mo–So) und die Woche davor. */
export function lastCompletedWeek(now = new Date()): WeeklyReportWindow {
  const end = startOfCurrentWeek(now)
  const start = previousMonday(end)
  return { start, end, previousStart: previousMonday(start), key: dateKey(start) }
}

/**
 * Fällig, sobald in der laufenden Woche Montag {@link WEEKLY_REPORT_HOUR} Uhr
 * vorbei ist und die Vorwoche noch nicht gemeldet wurde. War der Server am
 * Montag aus, kommt der Bericht beim nächsten Lauf derselben Woche nach.
 */
export function isWeeklyReportDue(now: Date, lastSentKey: string | null) {
  const sendFrom = startOfCurrentWeek(now)
  sendFrom.setHours(WEEKLY_REPORT_HOUR, 0, 0, 0)
  if (now < sendFrom) return false
  return lastSentKey !== lastCompletedWeek(now).key
}

/** ISO-Kalenderwoche (Montag als Wochenbeginn). */
export function isoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export type WeeklyMetric = { current: number; previous: number }

export type WeeklyReportData = {
  window: WeeklyReportWindow
  hires: WeeklyMetric
  terminations: WeeklyMetric
  promotions: WeeklyMetric
  demotions: WeeklyMetric
  sanctions: WeeklyMetric
  dutyMs: WeeklyMetric
  /** Agents mit Dienstzeit in der berichteten Woche. */
  dutyParticipants: number
  topDuty: Array<{ name: string; durationMs: number }>
  /** Personalstand am Ende der Woche (ohne Ausgeschiedene). */
  currentAgents: number
}

/** „12 (▲ +3)“, „4 (▼ −2)“, „7 (=)“ – Vergleich mit der Vorwoche. */
export function formatWeeklyDelta(metric: WeeklyMetric, format: (value: number) => string = String) {
  const delta = metric.current - metric.previous
  if (delta === 0) return `${format(metric.current)} (=)`
  const sign = delta > 0 ? '▲ +' : '▼ −'
  return `${format(metric.current)} (${sign}${format(Math.abs(delta))})`
}

const dayFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })

export function weeklyReportMessage(data: WeeklyReportData, statisticsUrl?: string) {
  const lastDay = new Date(data.window.end)
  lastDay.setDate(lastDay.getDate() - 1)
  const range = `${dayFormat.format(data.window.start)}–${dayFormat.format(lastDay)}`

  const rows = markdownRows([
    { label: 'Einstellungen', value: formatWeeklyDelta(data.hires), icon: '🆕' },
    { label: 'Kündigungen', value: formatWeeklyDelta(data.terminations), icon: '🚪' },
    { label: 'Beförderungen', value: formatWeeklyDelta(data.promotions), icon: '⬆️' },
    { label: 'Degradierungen', value: formatWeeklyDelta(data.demotions), icon: '⬇️' },
    { label: 'Sanktionen', value: formatWeeklyDelta(data.sanctions), icon: '⚖️' },
    { label: 'Dienststunden', value: formatWeeklyDelta(data.dutyMs, formatDuration), icon: '⏱️' },
    { label: 'Im Dienst gewesen', value: `${data.dutyParticipants} von ${data.currentAgents} Agents`, icon: '👥' },
  ])

  const top = data.topDuty.length > 0
    ? `**Meiste Dienstzeit**\n${data.topDuty.map((row, index) => `${index + 1}. ${row.name} · \`${formatDuration(row.durationMs)}\``).join('\n')}`
    : null

  const components = [
    textDisplay(markdownHeader('📊', `Wochenbericht KW ${isoWeekNumber(data.window.start)}`, range)),
    separator(),
    textDisplay(rows),
    ...(top ? [separator(), textDisplay(top)] : []),
    textDisplay(markdownMeta(['Vergleich mit der Vorwoche', `Personalstand ${data.currentAgents}`])),
    ...(statisticsUrl ? [actionRow([linkButton('Statistik öffnen', statisticsUrl)])] : []),
  ]
  return componentMessage(components)
}
