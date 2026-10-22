import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultInvestigationFilters,
  readInvestigationViews,
  sameInvestigationFilters,
} from '../src/lib/investigation-saved-views'
import { checklistProgress } from '../src/lib/investigation-templates'
import { myInvestigationsWhere } from '../src/lib/investigations'
import type { CurrentUser } from '../src/lib/auth'

test('Gespeicherte Aktenansichten: gültige bleiben, kaputte fallen weg', () => {
  const views = [{ id: 'a', name: 'Meine kritischen', filters: { ...defaultInvestigationFilters, priority: 'CRITICAL' as const, mine: true } }]
  assert.deepEqual(readInvestigationViews(JSON.stringify(views)), views)
  for (const raw of [null, '{broken', '{}', JSON.stringify([{ ...views[0], filters: { ...views[0].filters, status: 'GONE' } }])]) {
    assert.deepEqual(readInvestigationViews(raw), [])
  }
  assert.equal(sameInvestigationFilters(defaultInvestigationFilters, { ...defaultInvestigationFilters }), true)
  assert.equal(sameInvestigationFilters(defaultInvestigationFilters, { ...defaultInvestigationFilters, mine: true }), false)
})

test('Checklisten-Fortschritt', () => {
  assert.equal(checklistProgress(null), null)
  assert.equal(checklistProgress([]), null)
  assert.deepEqual(checklistProgress([
    { id: '1', label: 'Tatort sichern', done: true },
    { id: '2', label: 'Zeugen befragen', done: false },
    { id: '3', label: 'Bericht', done: true },
  ]), { done: 2, total: 3 })
})

test('Meine Akten: Fallführung oder Zuweisung über das eigene Agent-Profil', () => {
  const user: CurrentUser = { id: 'u1', username: 'u1', displayName: 'U', discordId: '111111111111111111', avatarUrl: null, groups: [], permissions: [] }
  const self = { status: { not: 'TERMINATED' }, OR: [{ userId: 'u1' }, { discordId: '111111111111111111' }] }
  assert.deepEqual(myInvestigationsWhere(user), { OR: [{ leadAgent: self }, { assignees: { some: { agent: self } } }] })
})

test('Übergabe: Chronologie-Text mit und ohne bisherige Fallführung', async () => {
  const { handoverEntryContent } = await import('../src/lib/investigations')
  assert.equal(handoverEntryContent('A (1)', 'B (2)', '  Spur X offen  '), 'Fallführung von A (1) an B (2) übergeben.\n\nSpur X offen')
  assert.equal(handoverEntryContent(null, 'B (2)', 'Neu'), 'Fallführung an B (2) übergeben.\n\nNeu')
})
