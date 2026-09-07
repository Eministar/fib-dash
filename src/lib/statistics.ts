export const STATISTICS_RANGES = ['week', '30d', '90d', 'year'] as const

export type StatisticsRange = (typeof STATISTICS_RANGES)[number]

export type StatisticsMetric = {
  current: number
  previous: number
}

export type StatisticsSeriesPoint = {
  key: string
  label: string
  shortLabel: string
  hires: number
  trainingCompletions: number
  promotions: number
  demotions: number
  terminations: number
}

export type StatisticsStaffRow = {
  id: string
  displayName: string
  avatarUrl: string | null
  hires: number
  trainingCompletions: number
  promotions: number
  demotions: number
  terminations: number
  sanctions: number
  total: number
}

export type StatisticsPayload = {
  period: {
    range: StatisticsRange
    label: string
    start: string
    end: string
  }
  overview: {
    hires: StatisticsMetric
    trainingCompletions: StatisticsMetric
    promotions: StatisticsMetric
    demotions: StatisticsMetric
    terminations: StatisticsMetric
    sanctions: StatisticsMetric
  }
  additional: {
    currentAgents: number
    activeAgents: number
    trainingAssignments: number
    completedTrainingAssignments: number
    trainingCompletionRate: number
    agentsWithOpenTrainings: number
    applications: StatisticsMetric
    probationStarts: StatisticsMetric
    newTrainingTypes: StatisticsMetric
  }
  series: StatisticsSeriesPoint[]
  staff: StatisticsStaffRow[]
  rankDistribution: Array<{ id: string; label: string; color: string; count: number }>
  trainingDistribution: Array<{ id: string; label: string; completed: number; total: number; percentage: number }>
  applicationFunnel: Array<{ status: string; label: string; count: number }>
  latestActivity: Array<{
    id: string
    type: 'HIRE' | 'TRAINING' | 'PROMOTION' | 'DEMOTION' | 'TERMINATION'
    title: string
    subject: string
    actor: string
    createdAt: string
  }>
}

export type StatisticsPeriod = {
  range: StatisticsRange
  label: string
  start: Date
  end: Date
  intervalEnd: Date
  previousStart: Date
  previousEnd: Date
}

export type StatisticsBucketWindow = {
  key: string
  label: string
  shortLabel: string
  start: Date
  end: Date
}

const berlinDate = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Berlin',
})

const berlinDay = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  timeZone: 'Europe/Berlin',
})

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  result.setHours(0, 0, 0, 0)
  return result
}

function addMonths(date: Date, months: number) {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months, 1)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfWeek(date: Date) {
  const start = startOfDay(date)
  const day = start.getDay()
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day))
  return start
}

export function isStatisticsRange(value: unknown): value is StatisticsRange {
  return typeof value === 'string' && STATISTICS_RANGES.some((range) => range === value)
}

export function resolveStatisticsPeriod(range: StatisticsRange, now = new Date()): StatisticsPeriod {
  let start: Date
  let intervalEnd: Date
  let label: string

  if (range === 'week') {
    start = startOfWeek(now)
    intervalEnd = addDays(start, 7)
    label = 'Diese Woche'
  } else if (range === '30d') {
    start = addDays(startOfDay(now), -29)
    intervalEnd = addDays(start, 30)
    label = 'Letzte 30 Tage'
  } else if (range === '90d') {
    start = addDays(startOfDay(now), -89)
    intervalEnd = addDays(start, 90)
    label = 'Letzte 90 Tage'
  } else {
    start = new Date(now.getFullYear(), 0, 1)
    intervalEnd = new Date(now.getFullYear() + 1, 0, 1)
    label = `Jahr ${now.getFullYear()}`
  }

  const elapsedMs = Math.max(1, now.getTime() - start.getTime())
  return {
    range,
    label,
    start,
    end: now,
    intervalEnd,
    previousStart: new Date(start.getTime() - elapsedMs),
    previousEnd: start,
  }
}

export function createStatisticsBuckets(period: StatisticsPeriod): StatisticsBucketWindow[] {
  if (period.range === 'week' || period.range === '30d') {
    const days = period.range === 'week' ? 7 : 30
    return Array.from({ length: days }, (_, index) => {
      const start = addDays(period.start, index)
      return {
        key: start.toISOString(),
        label: `${berlinDay.format(start)}, ${berlinDate.format(start)}`,
        shortLabel: period.range === 'week' ? berlinDay.format(start).replace('.', '') : berlinDate.format(start).slice(0, 5),
        start,
        end: addDays(start, 1),
      }
    })
  }

  if (period.range === '90d') {
    const buckets: StatisticsBucketWindow[] = []
    for (let start = new Date(period.start); start < period.intervalEnd; start = addDays(start, 7)) {
      const end = addDays(start, 7)
      const clippedEnd = end > period.intervalEnd ? period.intervalEnd : end
      buckets.push({
        key: start.toISOString(),
        label: `${berlinDate.format(start)} – ${berlinDate.format(addDays(clippedEnd, -1))}`,
        shortLabel: berlinDate.format(start).slice(0, 5),
        start,
        end: clippedEnd,
      })
    }
    return buckets
  }

  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(period.start.getFullYear(), index, 1)
    return {
      key: start.toISOString(),
      label: new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(start),
      shortLabel: new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'Europe/Berlin' }).format(start).replace('.', ''),
      start,
      end: addMonths(start, 1),
    }
  })
}

export function isInCurrentPeriod(date: Date, period: StatisticsPeriod) {
  return date >= period.start && date < period.end
}

export function isInPreviousPeriod(date: Date, period: StatisticsPeriod) {
  return date >= period.previousStart && date < period.previousEnd
}
