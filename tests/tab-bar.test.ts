import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveTab } from '../src/components/ui/tab-bar'

const tabs = [
  { id: 'chronologie', label: 'Chronologie' },
  { id: 'medien', label: 'Medien' },
]

test('Ein gültiger Reitername aus der URL wird übernommen', () => {
  assert.equal(resolveTab('medien', tabs), 'medien')
})

test('Fehlende, leere oder erfundene Reiternamen landen auf dem ersten Reiter', () => {
  // Ein geteilter Link darf nie eine leere Seite zeigen, auch wenn der Reiter
  // inzwischen umbenannt wurde.
  for (const value of [null, undefined, '', 'gibtsnicht', 'MEDIEN']) {
    assert.equal(resolveTab(value, tabs), 'chronologie')
  }
})
