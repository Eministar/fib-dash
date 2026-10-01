import assert from 'node:assert/strict'
import { test } from 'node:test'
import { custodyHash, orderCustodyChain, type StoredCustodyEvent } from '../src/lib/custody-chain'
import { currentHolder } from '../src/lib/custody'

function chain(actions: { action: string; toHolder?: string; at: string }[]): StoredCustodyEvent[] {
  const events: StoredCustodyEvent[] = []
  let prevHash: string | null = null
  actions.forEach((step, index) => {
    const data = {
      chainKey: 'ev1',
      evidenceId: 'ev1',
      itemNumber: 'ASV-0001',
      investigationId: 'inv1',
      action: step.action,
      actorId: 'u1',
      actorName: 'Agent A',
      fromHolder: null,
      toHolder: step.toHolder ?? null,
      location: null,
      note: null,
      createdAt: new Date(step.at),
    }
    const hash = custodyHash(prevHash, data)
    events.push({ ...data, id: `e${index + 1}`, prevHash, hash })
    prevHash = hash
  })
  return events
}

const steps = [
  { action: 'CREATED', at: '2026-09-01T10:00:00.000Z' },
  { action: 'TRANSFERRED', toHolder: 'Labor', at: '2026-09-01T11:00:00.000Z' },
  // Gleiche Millisekunde wie davor: die Reihenfolge kommt aus den Verweisen.
  { action: 'TRANSFERRED', toHolder: 'Asservatenkammer', at: '2026-09-01T11:00:00.000Z' },
]

test('intakte Kette wird über die Verweise geordnet – unabhängig von der Eingabereihenfolge', () => {
  const events = chain(steps)
  const { ordered, integrity } = orderCustodyChain([events[2], events[0], events[1]])
  assert.deepEqual(integrity, { valid: true, brokenAtId: null })
  assert.deepEqual(ordered.map((event) => event.id), ['e1', 'e2', 'e3'])
})

test('nachträglich geänderter Inhalt fällt auf', () => {
  const events = chain(steps)
  events[1] = { ...events[1], toHolder: 'Jemand anderes' }
  const { integrity } = orderCustodyChain(events)
  assert.deepEqual(integrity, { valid: false, brokenAtId: 'e2' })
})

test('gelöschter Eintrag in der Mitte fällt auf, nichts verschwindet aus der Anzeige', () => {
  const events = chain(steps)
  const { ordered, integrity } = orderCustodyChain([events[0], events[2]])
  assert.equal(integrity.valid, false)
  assert.equal(integrity.brokenAtId, 'e3')
  assert.deepEqual(ordered.map((event) => event.id), ['e1', 'e3'])
})

test('Gabelung (zwei Nachfolger desselben Eintrags) fällt auf', () => {
  const events = chain(steps.slice(0, 2))
  const fork = { ...events[1], id: 'fork', toHolder: 'Doppelt', hash: custodyHash(events[0].hash, { ...events[1], toHolder: 'Doppelt' }) }
  const { integrity } = orderCustodyChain([...events, fork])
  assert.equal(integrity.valid, false)
})

test('evidenceId ist nicht Teil des Hashes (wird beim Löschen NULL)', () => {
  const events = chain(steps).map((event) => ({ ...event, evidenceId: null }))
  assert.equal(orderCustodyChain(events).integrity.valid, true)
})

test('leere Kette ist gültig; aktueller Verwahrer ist der letzte Übergabe-Empfänger', () => {
  assert.deepEqual(orderCustodyChain([]).integrity, { valid: true, brokenAtId: null })
  assert.equal(currentHolder(chain(steps)), 'Asservatenkammer')
  assert.equal(currentHolder(chain(steps.slice(0, 1))), null)
})
