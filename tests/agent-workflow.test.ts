import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visibleAgentTaskModules, missingAgentTrainings } from '../src/lib/agent-open-tasks'
import { emptyAgentFilters, readAgentViews, sameAgentFilters } from '../src/lib/agent-saved-views'
import { leadershipGroupSchema, remapFamilyLeads } from '../src/lib/leadership-groups'

test('Agent tasks never include modules without view permission', () => {
  assert.deepEqual(visibleAgentTaskModules({ permissions: ['agents:view'] }), [])
  assert.deepEqual(visibleAgentTaskModules({ permissions: ['hr:view', 'sru:manage', 'internal-affairs:manage'] }), ['HR'])
  assert.deepEqual(visibleAgentTaskModules({ permissions: ['academy:view', 'internal-affairs:view'] }), ['ACADEMY', 'INTERNAL_AFFAIRS'])
})

test('Missing training excludes completed, rank-locked and terminated cases', () => {
  const agent = { status: 'ACTIVE', rank: { sortOrder: 5 }, trainings: [{ trainingId: 'done', completed: true }] }
  const trainings = [
    { id: 'open', label: 'Grundausbildung', sortOrder: 1, minRank: null },
    { id: 'done', label: 'Fahrtraining', sortOrder: 2, minRank: null },
    { id: 'locked', label: 'Führung', sortOrder: 3, minRank: { sortOrder: 2 } },
    { id: 'eligible', label: 'Funk', sortOrder: 4, minRank: { sortOrder: 5 } },
  ]
  assert.deepEqual(missingAgentTrainings(agent, trainings).map(task => task.id), ['open', 'eligible'])
  assert.deepEqual(missingAgentTrainings({ ...agent, status: 'TERMINATED' }, trainings), [])
})

test('Saved views roundtrip all filters and reject corrupt browser data', () => {
  const filters = { ...emptyAgentFilters, search: 'Perez', unit: 'HR', rank: 'rank-1', flag: 'RED' as const, status: 'ACTIVE' as const }
  const views = [{ id: 'v1', name: 'Meine Auswahl', filters }]
  assert.deepEqual(readAgentViews(JSON.stringify(views)), views)
  for (const raw of [null, '{broken', '{}', JSON.stringify([{ ...views[0], filters: { ...filters, status: 'unknown' } }])]) assert.deepEqual(readAgentViews(raw), [])
  assert.equal(sameAgentFilters(filters, { ...filters }), true)
  assert.equal(sameAgentFilters(filters, { ...filters, unit: '' }), false)
})

test('Family dossier links survive membership changes and accept unlinking', () => {
  const family = { name: 'Founders Company', leadIds: ['agent-1', 'agent-2'], dossierId: 'family-dossier' }
  assert.deepEqual(remapFamilyLeads([family], id => id === 'agent-1' ? null : id), [{ ...family, leadIds: ['agent-2'] }])
  const group = { name: 'Ermittlungsgruppe', memberIds: ['agent-1', 'agent-2'], families: [family] }
  assert.equal(leadershipGroupSchema.safeParse(group).success, true)
  assert.equal(leadershipGroupSchema.safeParse({ ...group, families: [{ ...family, dossierId: null }] }).success, true)
  assert.equal(leadershipGroupSchema.safeParse({ ...group, families: [family, { ...family, name: 'Andere Familie' }] }).success, false)
  assert.equal(leadershipGroupSchema.safeParse({ ...group, families: [{ ...family, dossierId: ' ' }] }).success, false)
})
