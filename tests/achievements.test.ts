import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeAchievements, fullMonthsBetween } from '../src/lib/agents/achievements'

const HOUR = 3_600_000
const base = { hireDate: new Date(2026, 9, 3), totalDutyMs: 0, completedTrainings: 0, closedCasesLed: 0, agentOfWeekWins: [] }

test('Volle Monate zählen erst ab dem gleichen Kalendertag', () => {
  assert.equal(fullMonthsBetween(new Date(2026, 0, 31), new Date(2026, 1, 28)), 0)
  assert.equal(fullMonthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15)), 1)
  assert.equal(fullMonthsBetween(new Date(2025, 9, 3), new Date(2026, 9, 3)), 12)
  assert.equal(fullMonthsBetween(new Date(2027, 0, 1), new Date(2026, 0, 1)), 0)
})

test('Ohne Daten gibt es keine Abzeichen', () => {
  assert.deepEqual(computeAchievements({ ...base, now: new Date(2026, 9, 3) }), [])
})

test('Je Kategorie zählt nur die höchste erreichte Stufe', () => {
  const list = computeAchievements({
    ...base,
    hireDate: new Date(2025, 3, 1),
    totalDutyMs: 120 * HOUR,
    completedTrainings: 5,
    closedCasesLed: 12,
    now: new Date(2026, 9, 3),
  })
  assert.deepEqual(list.map((item) => item.id), ['service-12', 'duty-100', 'training-5', 'cases-10'])
  assert.equal(list.find((item) => item.id === 'service-12')?.tier, 3)
})

test('Agent der Woche listet die Wochen sortiert und steigert die Stufe', () => {
  const [honor] = computeAchievements({ ...base, agentOfWeekWins: ['2026-W44', '2026-W40'], now: new Date(2026, 9, 3) })
  assert.equal(honor.id, 'agent-of-week')
  assert.equal(honor.title, '2× Agent der Woche')
  assert.equal(honor.description, 'KW 40, KW 44')
  assert.equal(honor.tier, 2)
})

test('Agent der Woche nennt das Jahr, wenn Siege über mehrere Jahre gehen', () => {
  const honor = computeAchievements({ ...base, agentOfWeekWins: ['2027-W01', '2026-W52'], now: new Date(2027, 0, 10) })
    .find((item) => item.id === 'agent-of-week')
  assert.equal(honor?.description, 'KW 52/2026, KW 1/2027')
})
