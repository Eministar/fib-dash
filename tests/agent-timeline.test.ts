import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_TIMELINE_CATEGORIES, formatDuration, parseTimelineCategories } from '../src/lib/agent-timeline'

test('Kategorien aus der URL: Standard ohne Dienstzeit/Protokoll, Unbekanntes wird ignoriert', () => {
  assert.deepEqual(parseTimelineCategories(null), DEFAULT_TIMELINE_CATEGORIES)
  assert.ok(!DEFAULT_TIMELINE_CATEGORIES.includes('duty'))
  assert.ok(!DEFAULT_TIMELINE_CATEGORIES.includes('audit'))
  assert.deepEqual(parseTimelineCategories('sanction,rank'), ['sanction', 'rank'])
  assert.deepEqual(parseTimelineCategories('quatsch'), DEFAULT_TIMELINE_CATEGORIES)
  assert.deepEqual(parseTimelineCategories('duty,quatsch'), ['duty'])
})

test('Dauer lesbar formatiert', () => {
  assert.equal(formatDuration(0), '0 Min.')
  assert.equal(formatDuration(45 * 60_000), '45 Min.')
  assert.equal(formatDuration(2 * 3_600_000), '2 Std.')
  assert.equal(formatDuration(90 * 60_000), '1 Std. 30 Min.')
})
