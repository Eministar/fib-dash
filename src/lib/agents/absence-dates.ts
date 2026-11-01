/**
 * Datumslogik für Abmeldungen – immer in deutscher Zeit (Europe/Berlin),
 * unabhängig von der Zeitzone des Servers (Container laufen in UTC).
 */

const TIME_ZONE = 'Europe/Berlin'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function berlinParts(date: Date) {
  const parts = partsFormatter.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

/** Abstand Berliner Wanduhr zu UTC in ms für einen Zeitpunkt. */
function berlinOffsetMs(utcMs: number) {
  const p = berlinParts(new Date(utcMs))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000
}

/** Zeitpunkt zu einer Berliner Wanduhrzeit (month 1-basiert). */
export function berlinDateTime(year: number, month: number, day: number, hours = 0, minutes = 0) {
  const wall = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  let utc = wall - berlinOffsetMs(wall)
  utc = wall - berlinOffsetMs(utc)
  const date = new Date(utc)
  if (Number.isNaN(date.getTime())) return null
  // Ungültige Kalenderdaten (31.02.) nicht stillschweigend verschieben.
  const check = berlinParts(date)
  if (check.year !== year || check.month !== month || check.day !== day) return null
  return date
}

export function parseAbsenceDate(value: string, fallbackTime?: { hours: number; minutes: number }) {
  const input = value.trim()
  if (!input) return null

  const isoLocal = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/)
  if (isoLocal) {
    const hours = isoLocal[4] ? Number.parseInt(isoLocal[4], 10) : fallbackTime?.hours ?? 0
    const minutes = isoLocal[5] ? Number.parseInt(isoLocal[5], 10) : fallbackTime?.minutes ?? 0
    return berlinDateTime(Number(isoLocal[1]), Number(isoLocal[2]), Number(isoLocal[3]), hours, minutes)
  }

  const german = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (german) {
    const hours = german[4] ? Number.parseInt(german[4], 10) : fallbackTime?.hours ?? 0
    const minutes = german[5] ? Number.parseInt(german[5], 10) : fallbackTime?.minutes ?? 0
    return berlinDateTime(Number(german[3]), Number(german[2]), Number(german[1]), hours, minutes)
  }

  // Vollständiges ISO mit Z/Offset (z. B. aus toISOString()) ist eindeutig.
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    const iso = new Date(input)
    return Number.isNaN(iso.getTime()) ? null : iso
  }

  return null
}

/** Ende einer relativen Abmeldung: Stunden exakt, Tage/Wochen bis 23:59 deutscher Zeit. */
export function absenceUntilFromNow(amount: number, unit: 'hours' | 'days' | 'weeks', now = new Date()) {
  if (unit === 'hours') return new Date(now.getTime() + amount * 3_600_000)
  const today = berlinParts(now)
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day + amount * (unit === 'weeks' ? 7 : 1)))
  return berlinDateTime(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 23, 59)!
}
