import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentHitActions, allowedAgentActions, allowedPageActions, isPlainShortcut, newActionForPath } from '../src/lib/palette-actions'

test('Aktionen erscheinen nur mit dem passenden Recht', () => {
  assert.deepEqual(allowedPageActions({ permissions: [] }), [])
  assert.deepEqual(allowedAgentActions(null), [])

  const investigator = { permissions: ['investigations:manage'] }
  assert.deepEqual(
    allowedPageActions(investigator).map((action) => action.id),
    ['new-investigation', 'new-person', 'new-vehicle'],
  )

  const hr = { permissions: ['sanctions:manage', 'agents:view'] }
  assert.deepEqual(allowedAgentActions(hr).map((action) => action.id), ['sanction', 'timeline'])
})

test('Kontextaktionen zu einem Agent zeigen auf die richtige Seite', () => {
  const actions = agentHitActions({ permissions: ['sanctions:manage', 'agents:write'] }, 'a1', 'Max Muster')
  assert.deepEqual(actions, [
    { id: 'sanction:a1', title: 'Sanktion für Max Muster', icon: 'sanction', target: { path: '/agents/a1', action: 'sanction' } },
    { id: 'absence:a1', title: 'Abmeldung für Max Muster', icon: 'absence', target: { path: '/agents/a1', action: 'absence' } },
  ])
})

test('Taste N: nur auf Seiten mit Anlage-Aktion und mit Recht', () => {
  const investigator = { permissions: ['investigations:manage'] }
  assert.equal(newActionForPath(investigator, '/investigations')?.id, 'new-investigation')
  assert.equal(newActionForPath(investigator, '/investigations/persons')?.id, 'new-person')
  assert.equal(newActionForPath(investigator, '/dashboard'), null)
  assert.equal(newActionForPath({ permissions: ['investigations:view'] }, '/investigations'), null)
})

test('Taste N: kein Treffer mit Modifier oder gehaltener Taste', () => {
  const key = { key: 'n', ctrlKey: false, metaKey: false, altKey: false, repeat: false }
  assert.equal(isPlainShortcut(key, 'n'), true)
  assert.equal(isPlainShortcut({ ...key, key: 'N' }, 'n'), true)
  assert.equal(isPlainShortcut({ ...key, ctrlKey: true }, 'n'), false)
  assert.equal(isPlainShortcut({ ...key, metaKey: true }, 'n'), false)
  assert.equal(isPlainShortcut({ ...key, repeat: true }, 'n'), false)
})
