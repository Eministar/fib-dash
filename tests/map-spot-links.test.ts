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
    observations: [
      { id: 'o1', note: 'Zwei Fahrzeuge, 20 Minuten', observedAt: new Date('2026-02-03T18:00:00Z'), createdBy: { displayName: 'Ermittler' } },
    ],
  })
  assert.deepEqual(spot.dossiers, [{ id: 'd1', title: 'Familie Moretti', kind: 'FAMILY' }])
  assert.deepEqual(spot.investigations, [{ id: 'i1', caseNumber: 'ERM-0001', title: 'Waffenhandel', classified: true }])
  assert.equal(spot.createdByName, 'Unbekannt')
})

test('Beobachtungen kommen mit Datum als ISO-String und benanntem Ersteller heraus', () => {
  const spot = serializeSpot({
    id: 'spot-2', title: 'Route Süd', description: '', category: 'waffen', icon: null,
    x: 1, y: 2, createdById: null, createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    dossiers: [], investigations: [],
    observations: [
      { id: 'o1', note: 'Übergabe beobachtet', observedAt: new Date('2026-02-03T18:00:00Z'), createdBy: { displayName: 'Ermittler' } },
      // Gelöschte Benutzer setzen `createdById` auf NULL – die Beobachtung bleibt.
      { id: 'o2', note: 'Nichts auffällig', observedAt: new Date('2026-02-01T09:30:00Z'), createdBy: null },
    ],
  })
  assert.equal(spot.observations.length, 2)
  assert.equal(spot.observations[0].observedAt, '2026-02-03T18:00:00.000Z')
  assert.equal(spot.observations[0].createdByName, 'Ermittler')
  assert.equal(spot.observations[1].createdByName, 'Unbekannt')
})

test('Ein Punkt ohne geladene Beobachtungen liefert eine leere Liste statt undefined', () => {
  const spot = serializeSpot({
    id: 'spot-3', title: 'Sammler Ost', description: '', category: 'weed', icon: null,
    x: 3, y: 4, createdById: null, createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as never)
  assert.deepEqual(spot.observations, [])
})
