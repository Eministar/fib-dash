import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CurrentUser } from '../src/lib/auth'
import { serializeSpot, visibleSpotInclude } from '../src/lib/map-server'

const baseUser: CurrentUser = {
  id: 'user-1',
  username: 'ermittler',
  displayName: 'Ermittler',
  discordId: null,
  avatarUrl: null,
  groups: [],
  permissions: [],
}

test('Ohne Sonderrecht filtert der Include Verschlusssachen auf sichtbare Akten', () => {
  const include = visibleSpotInclude(baseUser)
  const where = include.investigations.where as { OR?: unknown[] }
  assert.ok(Array.isArray(where.OR), 'Die Sichtbarkeitsbedingung muss durchgereicht werden')
  assert.ok(JSON.stringify(where).includes('"classified":false'))
})

test('Mit investigations:classified bleibt der Include ungefiltert', () => {
  const include = visibleSpotInclude({ ...baseUser, permissions: ['investigations:classified'] })
  assert.deepEqual(include.investigations.where, {})
})

test('serializeSpot reicht verknüpfte Akten in stabiler Form nach außen', () => {
  const spot = serializeSpot({
    id: 'spot-1', title: 'Sammler Nord', description: '', category: 'weed', icon: null,
    x: 10, y: 20, createdById: null, createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
    dossiers: [{ id: 'd1', title: 'Familie Moretti', kind: 'FAMILY' }],
    investigations: [{ id: 'i1', caseNumber: 'ERM-0001', title: 'Waffenhandel', classified: true }],
  })
  assert.deepEqual(spot.dossiers, [{ id: 'd1', title: 'Familie Moretti', kind: 'FAMILY' }])
  assert.deepEqual(spot.investigations, [{ id: 'i1', caseNumber: 'ERM-0001', title: 'Waffenhandel', classified: true }])
  assert.equal(spot.createdByName, 'Unbekannt')
})
