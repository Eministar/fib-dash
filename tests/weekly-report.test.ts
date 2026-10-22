import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatWeeklyDelta,
  isWeeklyReportDue,
  isoWeekNumber,
  lastCompletedWeek,
  weeklyReportMessage,
  type WeeklyReportData,
} from '../src/lib/weekly-report'

// Mittwoch, 22.10.2026 – lokale Zeit wie auf dem Server.
const wednesday = new Date(2026, 9, 22, 14, 0)

test('Berichtswoche: letzte abgeschlossene Mo–So-Woche und die davor', () => {
  const window = lastCompletedWeek(wednesday)
  assert.deepEqual(window.start, new Date(2026, 9, 12))
  assert.deepEqual(window.end, new Date(2026, 9, 19))
  assert.deepEqual(window.previousStart, new Date(2026, 9, 5))
  assert.equal(window.key, '2026-10-12')
  // Am Sonntag ist die laufende Woche noch nicht abgeschlossen.
  assert.equal(lastCompletedWeek(new Date(2026, 9, 25, 23, 0)).key, '2026-10-12')
  assert.equal(lastCompletedWeek(new Date(2026, 9, 26, 0, 5)).key, '2026-10-19')
})

test('Fälligkeit: Montag ab 8 Uhr, einmal je Woche, Nachholen in derselben Woche', () => {
  const mondayEarly = new Date(2026, 9, 19, 7, 59)
  const mondayLate = new Date(2026, 9, 19, 8, 0)
  assert.equal(isWeeklyReportDue(mondayEarly, null), false)
  assert.equal(isWeeklyReportDue(mondayLate, null), true)
  assert.equal(isWeeklyReportDue(mondayLate, '2026-10-12'), false)
  assert.equal(isWeeklyReportDue(wednesday, '2026-10-05'), true)
})

test('Kalenderwoche nach ISO', () => {
  assert.equal(isoWeekNumber(new Date(2026, 9, 12)), 42)
  assert.equal(isoWeekNumber(new Date(2026, 0, 1)), 1)
  assert.equal(isoWeekNumber(new Date(2027, 0, 1)), 53)
})

test('Vergleich mit der Vorwoche', () => {
  assert.equal(formatWeeklyDelta({ current: 5, previous: 2 }), '5 (▲ +3)')
  assert.equal(formatWeeklyDelta({ current: 1, previous: 4 }), '1 (▼ −3)')
  assert.equal(formatWeeklyDelta({ current: 3, previous: 3 }), '3 (=)')
})

test('Nachricht: Kopf, Werte, Top-Liste und Link', () => {
  const data: WeeklyReportData = {
    window: lastCompletedWeek(wednesday),
    hires: { current: 2, previous: 1 },
    terminations: { current: 0, previous: 1 },
    promotions: { current: 4, previous: 4 },
    demotions: { current: 1, previous: 0 },
    sanctions: { current: 0, previous: 0 },
    dutyMs: { current: 10 * 3_600_000, previous: 8 * 3_600_000 },
    dutyParticipants: 12,
    topDuty: [{ name: 'Max Muster', durationMs: 5 * 3_600_000 }],
    currentAgents: 30,
  }
  const text = JSON.stringify(weeklyReportMessage(data, 'https://example.test/dashboard?view=statistics'))
  assert.match(text, /Wochenbericht KW 42/)
  assert.match(text, /12\.10\.–18\.10\./)
  assert.match(text, /10h 00m/)
  assert.match(text, /Max Muster/)
  assert.match(text, /12 von 30 Agents/)
  assert.match(text, /example\.test/)
  assert.doesNotMatch(JSON.stringify(weeklyReportMessage(data)), /Statistik öffnen/)
})
