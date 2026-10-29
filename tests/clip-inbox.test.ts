import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readInbox } from '../desktop/src/clip-inbox'

test('Posteingang stellt Entwurf und fehlgeschlagenen Upload wieder her', () => {
  const clip = { path: 'C:/clips/test.mp4', name: 'Test', sizeBytes: 100, savedAt: 123, durationSeconds: 30, uploadState: 'uploading', draft: { fields: { 'f-title': 'Einsatz', 'f-investigation': 'case1' }, start: 3, end: 20, duration: 30 } }
  const restored = readInbox(JSON.stringify([clip]))[0]
  assert.equal(restored.uploadState, 'failed')
  assert.deepEqual(restored.draft, clip.draft)
  assert.match(restored.failure!, /bereits angekommen/)
})

test('Leere, ungültige und beschädigte Posteingänge werden unterschieden', () => {
  assert.deepEqual(readInbox(null), [])
  assert.deepEqual(readInbox('[{"path":42}]'), [])
  assert.throws(() => readInbox('{broken'))
  assert.throws(() => readInbox('{}'))
})
