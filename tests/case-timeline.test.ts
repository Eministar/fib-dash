import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCaseTimeline, groupTimelineByDay, type TimelineSource } from '../src/lib/case-timeline'

const source: TimelineSource = {
  createdAt: '2026-09-01T08:00:00.000Z',
  closedAt: null,
  entries: [{ id: 'e1', kind: 'OPERATION', title: 'Zugriff', occurredAt: '2026-09-02T20:00:00.000Z', location: 'Hafen' }],
  clips: [
    { id: 'c1', title: 'Bodycam 1', recordedAt: '2026-09-02T20:05:00.000Z', createdAt: '2026-09-03T09:00:00.000Z', location: null },
    { id: 'c2', title: 'Bodycam 2', recordedAt: null, createdAt: '2026-09-03T10:00:00.000Z', location: null },
  ],
  evidence: [
    { id: 'v1', itemNumber: 'ASV-0001', title: 'Pistole', seizedAt: '2026-09-02T20:10:00.000Z', createdAt: '2026-09-03T08:00:00.000Z', seizedLocation: 'Hafen' },
  ],
  photos: [{ id: 'p1', title: 'Tatort', createdAt: '2026-09-02T21:00:00.000Z' }],
}

test('Zeitstrahl sortiert alle Quellen chronologisch', () => {
  const items = buildCaseTimeline(source, { OPERATION: 'Einsatz' })
  assert.deepEqual(
    items.map((item) => item.id),
    ['milestone:created', 'entry:e1', 'clip:c1', 'evidence:v1', 'photo:p1', 'clip:c2'],
  )
  assert.equal(items[1].subtitle, 'Einsatz · Hafen')
})

test('fehlende Aufnahmezeit fällt auf die Erfassung zurück und ist markiert', () => {
  const clip = buildCaseTimeline(source, {}).find((item) => item.id === 'clip:c2')
  assert.equal(clip?.at, '2026-09-03T10:00:00.000Z')
  assert.equal(clip?.approximate, true)
})

test('Beweiskette: nur Handlungen, kein Ansehen', () => {
  const items = buildCaseTimeline(source, {}, [
    { id: 'k1', evidenceId: 'v1', itemNumber: 'ASV-0001', action: 'VIEWED', actorName: 'A', toHolder: null, location: null, createdAt: '2026-09-04T10:00:00.000Z' },
    { id: 'k2', evidenceId: 'v1', itemNumber: 'ASV-0001', action: 'TRANSFERRED', actorName: 'A', toHolder: 'Labor', location: 'LSPD', createdAt: '2026-09-04T11:00:00.000Z' },
  ])
  const custody = items.filter((item) => item.kind === 'custody')
  assert.equal(custody.length, 1)
  assert.equal(custody[0].title, 'ASV-0001 übergeben')
  assert.equal(custody[0].subtitle, 'an Labor · LSPD · durch A')
})

test('Gruppierung nach Kalendertag', () => {
  const groups = groupTimelineByDay(buildCaseTimeline(source, {}), 'UTC')
  assert.deepEqual(groups.map((group) => [group.day, group.items.length]), [
    ['2026-09-01', 1],
    ['2026-09-02', 4],
    ['2026-09-03', 1],
  ])
})
