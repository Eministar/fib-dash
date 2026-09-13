import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  migratedSummary,
  planDossierMigration,
  planShareItemRewrites,
  resolveAnchor,
  type MigratableDossier,
} from '../src/lib/dossier-migration'

const byId = (rows: MigratableDossier[]) => new Map(rows.map(row => [row.id, row]))

test('Anker ist die nächste Nicht-FILE-Akte über der Unterakte', () => {
  const rows: MigratableDossier[] = [
    { id: 'fam', kind: 'FAMILY', parentId: null },
    { id: 'file', kind: 'FILE', parentId: 'fam' },
  ]
  assert.equal(resolveAnchor('file', byId(rows)), 'fam')
})

test('Anker überspringt ganze FILE-Ketten', () => {
  const rows: MigratableDossier[] = [
    { id: 'col', kind: 'COLLECTION', parentId: null },
    { id: 'a', kind: 'FILE', parentId: 'col' },
    { id: 'b', kind: 'FILE', parentId: 'a' },
    { id: 'c', kind: 'FILE', parentId: 'b' },
  ]
  assert.equal(resolveAnchor('c', byId(rows)), 'col')
})

test('Unterakte auf Wurzelebene hat keinen Anker', () => {
  const rows: MigratableDossier[] = [{ id: 'file', kind: 'FILE', parentId: null }]
  assert.equal(resolveAnchor('file', byId(rows)), null)
})

test('Ein Zyklus im Baum bricht die Ankersuche ab, statt zu hängen', () => {
  const rows: MigratableDossier[] = [
    { id: 'a', kind: 'FILE', parentId: 'b' },
    { id: 'b', kind: 'FILE', parentId: 'a' },
  ]
  assert.equal(resolveAnchor('a', byId(rows)), null)
})

test('planDossierMigration wandelt jede FILE-Akte um und hängt Nicht-FILE-Kinder an den Anker', () => {
  const rows: MigratableDossier[] = [
    { id: 'fam', kind: 'FAMILY', parentId: null },
    { id: 'file', kind: 'FILE', parentId: 'fam' },
    { id: 'haus', kind: 'PROPERTY', parentId: 'file' },
  ]
  const plan = planDossierMigration(rows)
  assert.deepEqual(plan.conversions, [{ id: 'file', anchorId: 'fam' }])
  assert.deepEqual(plan.reparents, [{ id: 'haus', parentId: 'fam' }])
})

test('Nicht-FILE-Kind unter einer wurzelständigen Unterakte wird zur Wurzelakte', () => {
  const rows: MigratableDossier[] = [
    { id: 'file', kind: 'FILE', parentId: null },
    { id: 'haus', kind: 'PROPERTY', parentId: 'file' },
  ]
  const plan = planDossierMigration(rows)
  assert.deepEqual(plan.reparents, [{ id: 'haus', parentId: null }])
})

test('Akten ohne FILE im Baum erzeugen keinen Plan', () => {
  const rows: MigratableDossier[] = [
    { id: 'fam', kind: 'FAMILY', parentId: null },
    { id: 'haus', kind: 'PROPERTY', parentId: 'fam' },
  ]
  const plan = planDossierMigration(rows)
  assert.deepEqual(plan.conversions, [])
  assert.deepEqual(plan.reparents, [])
})

test('migratedSummary hängt die Adresse an die Beschreibung', () => {
  assert.equal(migratedSummary('Hergang', 'Garage an der 7170'), 'Hergang\n\nAdresse: Garage an der 7170')
})

test('migratedSummary behält eine Adresse auch ohne Beschreibung', () => {
  assert.equal(migratedSummary(null, 'Elite'), 'Adresse: Elite')
})

test('migratedSummary liefert die Beschreibung unverändert, wenn keine Adresse da ist', () => {
  assert.equal(migratedSummary('Nur Text', null), 'Nur Text')
})

test('migratedSummary liefert null, wenn beide Felder leer sind', () => {
  assert.equal(migratedSummary(null, null), null)
  assert.equal(migratedSummary('   ', '  '), null)
})

test('Freigabe-Einträge werden auf die neue Einsatzakte umgeschrieben', () => {
  const mapping = new Map([['file', { investigationId: 'inv', title: 'ERM-0013 · Drogenhandel Elite' }]])
  const plan = planShareItemRewrites(
    [{ id: 'item', shareId: 'share', kind: 'DOSSIER', recordId: 'file' }],
    mapping,
    new Set<string>(),
  )
  assert.deepEqual(plan.updates, [
    { id: 'item', kind: 'CASE', recordId: 'inv', title: 'ERM-0013 · Drogenhandel Elite' },
  ])
  assert.deepEqual(plan.deletes, [])
})

test('Enthält dieselbe Freigabe die Ziel-Einsatzakte schon, wird der alte Eintrag gelöscht', () => {
  const mapping = new Map([['file', { investigationId: 'inv', title: 'ERM-0013 · Drogenhandel Elite' }]])
  const plan = planShareItemRewrites(
    [{ id: 'item', shareId: 'share', kind: 'DOSSIER', recordId: 'file' }],
    mapping,
    new Set(['share:CASE:inv']),
  )
  assert.deepEqual(plan.updates, [])
  assert.deepEqual(plan.deletes, ['item'])
})

test('Zwei Unterakten derselben Freigabe kollidieren nicht miteinander', () => {
  const mapping = new Map([
    ['file-a', { investigationId: 'inv-a', title: 'ERM-0013 · A' }],
    ['file-b', { investigationId: 'inv-b', title: 'ERM-0014 · B' }],
  ])
  const plan = planShareItemRewrites(
    [
      { id: 'item-a', shareId: 'share', kind: 'DOSSIER', recordId: 'file-a' },
      { id: 'item-b', shareId: 'share', kind: 'DOSSIER', recordId: 'file-b' },
    ],
    mapping,
    new Set<string>(),
  )
  assert.equal(plan.updates.length, 2)
  assert.deepEqual(plan.deletes, [])
})

test('Freigabe-Einträge auf Dauerakten und andere Bereiche bleiben unangetastet', () => {
  const mapping = new Map([['file', { investigationId: 'inv', title: 'ERM-0013 · X' }]])
  const plan = planShareItemRewrites(
    [
      { id: 'keep-dossier', shareId: 'share', kind: 'DOSSIER', recordId: 'bleibt' },
      { id: 'keep-person', shareId: 'share', kind: 'PERSON', recordId: 'file' },
    ],
    mapping,
    new Set<string>(),
  )
  assert.deepEqual(plan.updates, [])
  assert.deepEqual(plan.deletes, [])
})
