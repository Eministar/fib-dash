import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeAchievements, fullMonthsBetween } from '../src/lib/achievements'
import { isMonthKey, monthKey, monthKeyLabel, monthWinners, shiftMonthKey, voteRejection } from '../src/lib/agent-of-month'

const HOUR = 3_600_000
const base = { hireDate: new Date(2026, 9, 3), totalDutyMs: 0, completedTrainings: 0, closedCasesLed: 0, agentOfMonthWins: [] }

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

test('Agent des Monats listet die Monate sortiert und steigert die Stufe', () => {
  const [honor] = computeAchievements({ ...base, agentOfMonthWins: ['2026-09', '2026-07'], now: new Date(2026, 9, 3) })
  assert.equal(honor.title, '2× Agent des Monats')
  assert.equal(honor.description, 'Juli 2026, September 2026')
  assert.equal(honor.tier, 2)
})

test('Monatsschlüssel richten sich nach deutscher Zeit', () => {
  // 31.10. 23:30 UTC ist in Berlin schon der 1. November.
  assert.equal(monthKey(new Date('2026-10-31T23:30:00Z')), '2026-11')
  assert.equal(monthKey(new Date('2026-10-31T22:30:00Z')), '2026-10')
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12')
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01')
  assert.equal(monthKeyLabel('2026-03'), 'März 2026')
  assert.ok(isMonthKey('2026-10'))
  assert.ok(!isMonthKey('2026-13'))
})

test('Sieger: höchste Stimmenzahl, Gleichstand teilt den Titel', () => {
  assert.deepEqual(monthWinners([]), [])
  assert.deepEqual(monthWinners([{ agentId: 'a', votes: 3 }, { agentId: 'b', votes: 5 }]), [{ agentId: 'b', votes: 5 }])
  assert.deepEqual(monthWinners([{ agentId: 'a', votes: 2 }, { agentId: 'b', votes: 2 }]).map((row) => row.agentId), ['a', 'b'])
})

test('Stimmen: nur mit eigenem Agent, nicht für sich selbst, nur für aktive Agents', () => {
  assert.match(voteRejection({ voterAgentId: null, nomineeAgentId: 'a', nomineeActive: true }) ?? '', /verknüpftem Agent/)
  assert.match(voteRejection({ voterAgentId: 'a', nomineeAgentId: 'a', nomineeActive: true }) ?? '', /selbst/)
  assert.ok(voteRejection({ voterAgentId: 'a', nomineeAgentId: 'b', nomineeActive: false }))
  assert.equal(voteRejection({ voterAgentId: 'a', nomineeAgentId: 'b', nomineeActive: true }), null)
})
