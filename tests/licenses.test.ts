import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseLicenseInput } from '../src/lib/licenses/licenses'
import { normalizePermissions } from '../src/lib/permissions'

test('Lizenzart: Eingabe wird bereinigt', () => {
  assert.deepEqual(parseLicenseInput({ key: ' Fahren ', label: ' Fahrlizenz ', description: '  ', cooldownDays: 7, sortOrder: '2' }), {
    key: 'fahren',
    label: 'Fahrlizenz',
    description: null,
    cooldownDays: 7,
    sortOrder: 2,
    active: true,
  })
  const inactive = parseLicenseInput({ key: 'pdw_plus', label: 'PDW+', active: false })
  assert.ok(typeof inactive !== 'string' && inactive.active === false && inactive.cooldownDays === 0)
})

test('Lizenzart: ungültige Eingaben werden abgelehnt', () => {
  assert.equal(typeof parseLicenseInput(null), 'string')
  assert.equal(typeof parseLicenseInput({ key: 'fahren', label: '' }), 'string')
  assert.equal(typeof parseLicenseInput({ key: 'Fahr Lizenz', label: 'Fahrlizenz' }), 'string')
  assert.equal(typeof parseLicenseInput({ key: 'fahren', label: 'Fahrlizenz', cooldownDays: -1 }), 'string')
  assert.equal(typeof parseLicenseInput({ key: 'fahren', label: 'Fahrlizenz', cooldownDays: 1.5 }), 'string')
})

test('Lizenzen verwalten schließt das Ansehen der Agents ein', () => {
  assert.ok(normalizePermissions(['licenses:manage']).includes('agents:view'))
})
