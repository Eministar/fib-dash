import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inactivityTier, nextAgentFlag, shouldCreateInactivityEntry } from '../src/lib/inactivity-tier'

const DAY = 24 * 60 * 60_000
const now = new Date('2026-09-30T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY)

test('Stufen: unter 3 Tagen aktiv, ab 3 Tagen Warnung, ab 7 Tagen inaktiv', () => {
  assert.equal(inactivityTier(daysAgo(2.9), now), 'active')
  assert.equal(inactivityTier(daysAgo(3.1), now), 'warning')
  assert.equal(inactivityTier(daysAgo(6.9), now), 'warning')
  assert.equal(inactivityTier(daysAgo(7.1), now), 'inactive')
})

test('Markierung: Abmeldung blau, 3 Tage lila, 7 Tage gelb', () => {
  assert.equal(nextAgentFlag(null, true, 'inactive'), 'BLUE')
  assert.equal(nextAgentFlag(null, false, 'warning'), 'PURPLE')
  assert.equal(nextAgentFlag('PURPLE', false, 'inactive'), 'YELLOW')
})

test('Markierung: automatische Farben verschwinden bei Aktivität, manuelle bleiben', () => {
  assert.equal(nextAgentFlag('PURPLE', false, 'active'), null)
  assert.equal(nextAgentFlag('YELLOW', false, 'active'), null)
  assert.equal(nextAgentFlag('BLUE', false, 'active'), null)
  assert.equal(nextAgentFlag('RED', false, 'active'), 'RED')
  assert.equal(nextAgentFlag('ORANGE', false, 'active'), 'ORANGE')
})

test('Negativer Eintrag nur einmal pro Inaktivitätsphase', () => {
  const lastActivity = daysAgo(4)
  assert.equal(shouldCreateInactivityEntry({ tier: 'warning', hasAbsence: false, lastActivity, lastEntryAt: null, now }), true)
  assert.equal(shouldCreateInactivityEntry({ tier: 'warning', hasAbsence: false, lastActivity, lastEntryAt: daysAgo(1), now }), false)
  // Eintrag aus einer früheren Phase zählt nicht.
  assert.equal(shouldCreateInactivityEntry({ tier: 'warning', hasAbsence: false, lastActivity, lastEntryAt: daysAgo(20), now }), true)
})

test('Kein Eintrag bei Aktivität, Abmeldung oder sehr alter Fehlzeit', () => {
  assert.equal(shouldCreateInactivityEntry({ tier: 'active', hasAbsence: false, lastActivity: daysAgo(1), lastEntryAt: null, now }), false)
  assert.equal(shouldCreateInactivityEntry({ tier: 'warning', hasAbsence: true, lastActivity: daysAgo(4), lastEntryAt: null, now }), false)
  // Beim Rollout sollen Langzeit-Inaktive nicht rückwirkend angeschrieben werden.
  assert.equal(shouldCreateInactivityEntry({ tier: 'inactive', hasAbsence: false, lastActivity: daysAgo(30), lastEntryAt: null, now }), false)
  assert.equal(shouldCreateInactivityEntry({ tier: 'inactive', hasAbsence: false, lastActivity: daysAgo(8), lastEntryAt: null, now }), true)
})
