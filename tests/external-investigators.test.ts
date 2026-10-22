import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePermissions, resolveEffectivePermissions } from '../src/lib/permissions'
import { investigationVisibilityWhere } from '../src/lib/investigations'
import type { CurrentUser } from '../src/lib/auth'

test('Externer Ermittlungszugriff: Akten ansehen und bearbeiten', () => {
  const permissions = normalizePermissions(['investigations:external'])
  for (const expected of ['investigations:view', 'investigations:manage'] as const) {
    assert.ok(permissions.includes(expected), expected)
  }
})

test('Externer Ermittlungszugriff: keine Personalakten, kein Löschen, keine Übersicht', () => {
  const permissions = resolveEffectivePermissions([], [['investigations:external']])
  for (const forbidden of ['agents:view', 'investigations:delete', 'investigations:templates', 'dashboard:view'] as const) {
    assert.ok(!permissions.includes(forbidden), forbidden)
  }
})

test('Externer Ermittlungszugriff: sieht alle Akten', () => {
  const user: CurrentUser = {
    id: 'ext', username: 'ext', displayName: 'Extern', discordId: '222222222222222222', avatarUrl: null, groups: [],
    permissions: normalizePermissions(['investigations:external']),
  }
  assert.deepEqual(investigationVisibilityWhere(user), {})
})
