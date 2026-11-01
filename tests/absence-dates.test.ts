import test from 'node:test'
import assert from 'node:assert/strict'
import { absenceUntilFromNow, parseAbsenceDate } from '../src/lib/agents/absence-dates'

// Die Tests laufen mit TZ=UTC (wie der Container), damit Server-Lokalzeit nicht durchschlägt.
process.env.TZ = 'UTC'

test('deutsches Datum mit Uhrzeit wird als deutsche Zeit gelesen (Winterzeit)', () => {
  assert.equal(parseAbsenceDate('05.11.2026 18:00')?.toISOString(), '2026-11-05T17:00:00.000Z')
})

test('deutsches Datum mit Uhrzeit wird als deutsche Zeit gelesen (Sommerzeit)', () => {
  assert.equal(parseAbsenceDate('05.07.2026 18:00')?.toISOString(), '2026-07-05T16:00:00.000Z')
})

test('Datum ohne Uhrzeit nutzt die Rückfallzeit in deutscher Zeit', () => {
  assert.equal(parseAbsenceDate('2026-11-05', { hours: 23, minutes: 59 })?.toISOString(), '2026-11-05T22:59:00.000Z')
  assert.equal(parseAbsenceDate('5.11.2026')?.toISOString(), '2026-11-04T23:00:00.000Z')
})

test('datetime-local aus dem Dashboard (ohne Offset) ist deutsche Zeit', () => {
  assert.equal(parseAbsenceDate('2026-11-05T18:00')?.toISOString(), '2026-11-05T17:00:00.000Z')
})

test('ISO mit Offset bleibt unverändert', () => {
  assert.equal(parseAbsenceDate('2026-11-05T18:00:00.000Z')?.toISOString(), '2026-11-05T18:00:00.000Z')
})

test('ungültige Eingaben ergeben null', () => {
  assert.equal(parseAbsenceDate(''), null)
  assert.equal(parseAbsenceDate('morgen'), null)
})

test('„3 Tage“ endet um 23:59 deutscher Zeit, auch über Mitternacht UTC hinweg', () => {
  // 23:30 deutscher Zeit am 01.11. = 22:30 UTC, in UTC also noch derselbe Tag – in Berlin auch.
  const now = new Date('2026-11-01T22:30:00.000Z')
  assert.equal(absenceUntilFromNow(3, 'days', now).toISOString(), '2026-11-04T22:59:00.000Z')
  // 00:30 deutscher Zeit am 02.11. = 23:30 UTC am 01.11. → Berliner Kalendertag ist der 02.11.
  const afterMidnight = new Date('2026-11-01T23:30:00.000Z')
  assert.equal(absenceUntilFromNow(1, 'days', afterMidnight).toISOString(), '2026-11-03T22:59:00.000Z')
})

test('Tage über die Zeitumstellung hinweg', () => {
  const now = new Date('2026-10-24T10:00:00.000Z') // Sommerzeit
  assert.equal(absenceUntilFromNow(2, 'days', now).toISOString(), '2026-10-26T22:59:00.000Z') // Winterzeit
})

test('Stunden werden exakt addiert', () => {
  const now = new Date('2026-11-01T10:00:00.000Z')
  assert.equal(absenceUntilFromNow(5, 'hours', now).toISOString(), '2026-11-01T15:00:00.000Z')
})
