import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checklistFromTemplate, openRolesFromTemplate, parseTemplateInput, readChecklist, readOpenRoles, templatePrefill, mergeTemplatePrefill, composeTitle, type InvestigationTemplateData } from '../src/lib/investigation-templates'

const template: InvestigationTemplateData = {
  id: 'template', name: 'Drogen', description: null, titlePrefix: 'Drogen –', summary: 'Sachverhalt\n\nMaßnahmen',
  priority: 'HIGH', classified: false, checklist: ['Tatort sichern'], roles: [{ role: 'SUSPECT', label: 'Verkäufer' }],
  leadAgentId: 'lead', assigneeIds: ['agent', 'deleted'], active: true, sortOrder: 0, updatedAt: new Date().toISOString(),
}

test('jede Akte erhält unabhängige Checklisten und Rollen', () => {
  const first = checklistFromTemplate(template.checklist)
  const second = checklistFromTemplate(template.checklist)
  first[0].done = true
  assert.equal(second[0].done, false)
  assert.notEqual(first[0].id, second[0].id)
  assert.equal(second[0].doneAt, null)
  const roles = openRolesFromTemplate(template.roles)
  roles[0].label = 'Andere Person'
  assert.equal(template.roles[0].label, 'Verkäufer')
})

test('Vorlagenwechsel entfernt alte Vorgaben und filtert gelöschte Agents', () => {
  const empty = templatePrefill(null)
  const filled = templatePrefill(template, ['lead', 'agent'])
  assert.deepEqual(filled.assigneeIds, ['agent'])
  assert.deepEqual(mergeTemplatePrefill(filled, filled, empty), empty)
  assert.equal(empty.classified, true)
})

test('eigene Eingaben bleiben beim Vorlagenwechsel erhalten', () => {
  const previous = templatePrefill(template)
  const edited = { ...previous, title: 'Eigener Titel', summary: 'Eigener Text', priority: 'URGENT', classified: true, leadAgentId: 'other', assigneeIds: ['other'] }
  assert.deepEqual(mergeTemplatePrefill(edited, previous, templatePrefill(null)), edited)
  assert.equal(composeTitle('Drogen –', 'Drogen – Hafen'), 'Drogen – Hafen')
})

test('ungültige und zu lange Vorlagen werden abgelehnt', () => {
  for (const input of [null, [], { name: '' }, { name: 'a'.repeat(101) }, { name: 'Test', priority: 'invalid' }, { name: 'Test', checklist: Array(41).fill('Schritt') }, { name: 'Test', checklist: ['a'.repeat(201)] }]) {
    assert.equal(parseTemplateInput(input).ok, false)
  }
  const parsed = parseTemplateInput({ name: ' Test ', checklist: [' Sichern ', 'sichern', ''] })
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.value.checklist, ['Sichern'])
})

test('alte Akten ohne Vorlagendaten und beschädigte JSON-Einträge sind lesbar', () => {
  assert.deepEqual(readChecklist(null), [])
  assert.deepEqual(readOpenRoles(null), [])
  assert.deepEqual(readChecklist([null, 'x', { id: 'x' }]), [])
  assert.deepEqual(readOpenRoles([{ id: 'x', role: 'invalid' }]), [])
})
