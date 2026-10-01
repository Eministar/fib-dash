import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentHitActions, allowedAgentActions, allowedPageActions } from '../src/lib/palette-actions'

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
