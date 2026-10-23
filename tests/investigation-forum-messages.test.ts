import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DOSSIER_LINK_LIMIT,
  STATUS_ACCENT,
  dossierCard,
  dossierOverview,
  forumEventMessage,
  forumThreadName,
  investigationCard,
} from '../src/lib/investigations/investigation-forum-messages'

const text = (message: unknown) => JSON.stringify(message)
const box = (message: { components: Array<Record<string, unknown>> }) => message.components[0]

test('Beitragstitel: Aktenzeichen und Titel, höchstens 100 Zeichen', () => {
  assert.equal(forumThreadName('ERM-0042', 'Waffenhandel  Sandy Shores'), 'ERM-0042 · Waffenhandel Sandy Shores')
  const long = forumThreadName('ERM-1', 'x'.repeat(200))
  assert.equal(long.length, 100)
  assert.ok(long.endsWith('…'))
})

test('Aktenkarte: Status als Farbe und Text, Fallführung, Zähler, Link', () => {
  const message = investigationCard({
    caseNumber: 'ERM-0042', title: 'Waffenhandel', summary: 'Lieferungen über den Hafen.', status: 'ACTIVE', priority: 'HIGH',
    leadAgentName: 'Max Muster (12)', assigneeCount: 3, entryCount: 7, clipCount: 2,
    createdAt: new Date('2026-10-01T10:00:00Z'), updatedAt: new Date('2026-10-20T10:00:00Z'), url: 'https://example.test/investigations/1',
  })
  assert.equal(box(message).accent_color, STATUS_ACCENT.ACTIVE)
  const json = text(message)
  for (const part of ['Waffenhandel', 'ERM-0042', 'In Bearbeitung', 'Hoch', 'Max Muster (12)', '3 Ermittler', '7 Einträge', '2 Clips', '> Lieferungen', 'example.test']) {
    assert.ok(json.includes(part), part)
  }
})

test('Aktenkarte ohne Fallführung und ohne Zusammenfassung', () => {
  const json = text(investigationCard({
    caseNumber: 'ERM-1', title: 'T', summary: null, status: 'OPEN', priority: 'NORMAL', leadAgentName: null,
    assigneeCount: 0, entryCount: 0, clipCount: 0, createdAt: new Date(), updatedAt: new Date(),
  }))
  assert.ok(json.includes('nicht zugewiesen'))
  assert.ok(!json.includes('Akte im Dashboard öffnen'))
})

test('Familienakte: Leiter, Anwesen, laufende und abgeschlossene Akten getrennt, Thread-Links klickbar', () => {
  const json = text(dossierCard({
    title: 'Familie Moretti', leader: 'Paolo Moretti', description: null, address: 'Vinewood Hills', personCount: 4, vehicleCount: 2,
    cases: [
      { caseNumber: 'ERM-1', title: 'Drogen', status: 'ACTIVE', threadId: '111' },
      { caseNumber: 'ERM-2', title: 'Raub', status: 'CLOSED', threadId: '222' },
      { caseNumber: 'ERM-3', title: 'Ohne Beitrag', status: 'OPEN', threadId: null },
    ],
  }))
  assert.ok(json.includes('Familienakte'))
  assert.ok(json.includes('Fraktionsleiter: Paolo Moretti'))
  assert.ok(json.includes('Anwesen: Vinewood Hills'))
  assert.ok(json.includes('<#111>') && json.includes('<#222>'))
  assert.ok(json.includes('`ERM-3` Ohne Beitrag'))
  assert.ok(json.indexOf('Laufende Ermittlungen') < json.indexOf('Abgeschlossen'))
})

test('Familienakte mit sehr vielen Akten bleibt unter der Grenze', () => {
  const cases = Array.from({ length: DOSSIER_LINK_LIMIT + 5 }, (_, i) => ({ caseNumber: `ERM-${i}`, title: 'Akte', status: 'OPEN' as const, threadId: String(1e17 + i) }))
  const json = text(dossierCard({ title: 'Groß', leader: null, description: null, address: null, personCount: 0, vehicleCount: 0, cases }))
  assert.ok(json.includes('und 5 weitere'))
  assert.ok(json.length < 6000)
})

test('Übersicht listet alle Familienakten', () => {
  const json = text(dossierOverview([
    { title: 'Moretti', threadId: '1', caseCount: 3 },
    { title: 'Hafen', threadId: null, caseCount: 0 },
  ]))
  assert.ok(json.includes('Familienregister'))
  assert.ok(json.includes('<#1> · 3 Akten'))
  assert.ok(json.includes('Hafen · 0 Akten'))
})

test('Verlaufsmeldung: Titel, Werte ohne leere Zeilen, Notiz als Zitat', () => {
  const json = text(forumEventMessage({ type: 'handover', rows: [{ label: 'Von', value: 'A' }, { label: 'An', value: '' }], note: 'Spur offen', actorName: 'Chef' }))
  assert.ok(json.includes('Fallführung übergeben'))
  assert.ok(json.includes('**Von** A'))
  assert.ok(!json.includes('**An**'))
  assert.ok(json.includes('> Spur offen'))
  assert.ok(json.includes('Chef'))
})
