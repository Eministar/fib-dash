import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAccessInvestigation, investigationVisibilityWhere } from '../src/lib/investigations/investigations'
import type { CurrentUser } from '../src/lib/auth'

const user = (overrides: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u1', username: 'u1', displayName: 'Nutzer', discordId: '111111111111111111', avatarUrl: null, groups: [], permissions: ['investigations:view'], ...overrides,
})

test('ohne Verschlusssachen ist jede Akte für alle mit Akteneinsicht offen', () => {
  assert.equal(canAccessInvestigation(user(), {}), true)
  assert.equal(canAccessInvestigation(user({ discordId: null }), {}), true)
})

test('der Listenfilter blendet nichts aus', () => {
  assert.deepEqual(investigationVisibilityWhere(user()), {})
  assert.deepEqual(investigationVisibilityWhere(user({ discordId: null })), {})
})
