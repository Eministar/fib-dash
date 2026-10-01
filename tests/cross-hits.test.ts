import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  groupOtherCases,
  normalizePlate,
  personMatchReasons,
  personProbeIsSearchable,
  plateIsSearchable,
  plateSearchChunk,
} from '../src/lib/cross-hits'

test('Kennzeichen werden unabhängig von Schreibweise verglichen', () => {
  assert.equal(normalizePlate(' ls-123 ab '), 'LS123AB')
  assert.equal(normalizePlate('LS 123AB'), 'LS123AB')
  assert.equal(plateSearchChunk('ls-1234 ab'), '1234')
  assert.equal(plateIsSearchable('a-b'), false)
  assert.equal(plateIsSearchable('46E'), true)
})

test('Person: Name zählt nur vollständig, Alias/Kennung/Telefon einzeln', () => {
  const existing = { firstName: 'Jürgen', lastName: 'Müller', alias: 'Bull', identifier: 'ID-77', phone: '555-0199' }
  assert.deepEqual(personMatchReasons({ firstName: 'jurgen', lastName: 'MÜLLER' }, existing), ['Name'])
  assert.deepEqual(personMatchReasons({ lastName: 'Müller' }, existing), [])
  assert.deepEqual(personMatchReasons({ alias: 'bull' }, existing), ['Alias'])
  assert.deepEqual(personMatchReasons({ alias: 'Jürgen Müller' }, existing), ['Alias'])
  assert.deepEqual(personMatchReasons({ identifier: 'id-77', phone: '(555) 0199' }, existing), ['Kennung', 'Telefon'])
  assert.deepEqual(personMatchReasons({ phone: '99' }, existing), [])
})

test('Suche startet erst mit brauchbaren Eingaben', () => {
  assert.equal(personProbeIsSearchable({ firstName: 'Max' }), false)
  assert.equal(personProbeIsSearchable({ firstName: 'Max', lastName: 'M' }), true)
  assert.equal(personProbeIsSearchable({ phone: '12' }), false)
  assert.equal(personProbeIsSearchable({ alias: 'X1' }), true)
})

test('weitere Akten: ohne aktuelle Akte und ohne Doppelungen', () => {
  const a = { id: 'a', caseNumber: 'ERM-1', title: 'A' }
  const b = { id: 'b', caseNumber: 'ERM-2', title: 'B' }
  const current = { id: 'cur', caseNumber: 'ERM-9', title: 'Aktuell' }
  const grouped = groupOtherCases(
    [
      { key: 'p1', investigation: a },
      { key: 'p1', investigation: a },
      { key: 'p1', investigation: current },
      { key: 'p2', investigation: b },
    ],
    'cur',
  )
  assert.deepEqual(grouped, { p1: [a], p2: [b] })
})
