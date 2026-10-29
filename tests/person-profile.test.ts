import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CROP, dragCrop, parsePersonProfile } from '../src/lib/investigations/person-profile'

test('profile updates preserve omitted fields and support clearing text', () => {
  assert.deepEqual(parsePersonProfile({ notes: 'unchanged profile' }), {})
  assert.deepEqual(parsePersonProfile({ occupation: ' Mechaniker ', rank: '', organization: null }), { occupation: 'Mechaniker', rank: null, organization: null })
})

test('reject invalid profile data and crop values before database writes', () => {
  for (const body of [{ rank: 5 }, { occupation: 'x'.repeat(121) }, ...[null, {}, { x: -1, y: 50, zoom: 1 }, { x: 50, y: 101, zoom: 1 }, { x: 50, y: 50, zoom: 4 }, { x: '50', y: 50, zoom: 1 }, { x: NaN, y: 50, zoom: 1 }].map(photoCrop => ({ photoCrop }))]) {
    assert.equal(typeof parsePersonProfile(body), 'string')
  }
  assert.deepEqual(parsePersonProfile({ photoCrop: DEFAULT_CROP }), { photoCrop: DEFAULT_CROP })
})

test('dragging follows the pointer and clamps to covered image edges', () => {
  assert.deepEqual(dragCrop(DEFAULT_CROP, 40, 30, 160, 320, 160), { x: 25, y: 50, zoom: 1 })
  assert.deepEqual(dragCrop({ x: 50, y: 50, zoom: 2 }, -1000, 1000, 160, 160, 320), { x: 100, y: 0, zoom: 2 })
  assert.deepEqual(dragCrop(DEFAULT_CROP, 100, 100, 160, 160, 160), DEFAULT_CROP)
})

test('crop movement is independent of rendered avatar size', () => {
  const crop = { x: 50, y: 50, zoom: 1.5 }
  assert.deepEqual(dragCrop(crop, 10, -10, 100, 800, 600), dragCrop(crop, 20, -20, 200, 800, 600))
})
