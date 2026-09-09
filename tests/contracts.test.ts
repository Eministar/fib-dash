/**
 * Charakterisierungstests: sie schreiben fest, wie sich das Vertragssystem
 * HEUTE verhält — vor dem Umbau auf mehrere Unterzeichner. Sie sind die
 * Absicherung des Einstellungsverfahrens: schlägt hier nach dem Umbau etwas
 * fehl, ist die Migration schuld, nicht der Test.
 *
 * Diese Datei prüft nur, was ohne Datenbank läuft. Die Zustandsübergänge
 * stehen in `contracts-db.test.ts`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONTRACT_FIELD_TYPES,
  CONTRACT_STATUSES,
  formatContractDate,
  normalizeLinkToken,
  primarySignatureField,
  readContractClauses,
  readContractFields,
  renderContractContent,
  sanitizeContractFields,
  validateContractValues,
  type ContractField,
} from '../src/lib/contracts'

function field(patch: Partial<ContractField> & Pick<ContractField, 'id' | 'type' | 'label'>): ContractField {
  return { description: null, placeholder: null, required: false, sortOrder: 0, ...patch }
}

test('Platzhalter werden beim Anlegen aufgeloest, Ort und Datum bleiben stehen', () => {
  const context = {
    firstName: 'Jane',
    lastName: 'Doe',
    badgeNumber: '1234',
    rankName: 'Special Agent',
    hireDate: new Date('2026-03-04T00:00:00Z'),
    discordId: '99',
    units: ['SRU', 'LAD'],
  }

  const rendered = renderContractContent(
    'Hallo {{vorname}} {{nachname}} ({{name}}), Nr. {{dienstnummer}}, Rang {{rang}}, ' +
      'seit {{einstellungsdatum}}, Units {{units}}, Discord {{discord_id}}, {{department}}.',
    context,
  )

  assert.match(rendered, /Hallo Jane Doe \(Jane Doe\)/)
  assert.match(rendered, /Nr\. 1234/)
  assert.match(rendered, /Rang Special Agent/)
  assert.match(rendered, /Units SRU, LAD/)
  assert.match(rendered, /Federal Investigation Bureau/)

  // Ort und Datum werden bewusst erst beim Anzeigen ersetzt, damit auf dem
  // Dokument immer das aktuelle Datum steht.
  const kept = renderContractContent('{{ort}}, den {{datum}}', context)
  assert.equal(kept, '{{ort}}, den {{datum}}')

  // Ein Tippfehler in der Vorlage bleibt sichtbar, statt still zu verschwinden.
  assert.equal(renderContractContent('{{vorrname}}', context), '{{vorrname}}')
})

test('Link-Token werden streng normalisiert', () => {
  assert.equal(normalizeLinkToken('  abc123  '), 'abc123')
  assert.equal(normalizeLinkToken(''), '')
  assert.equal(normalizeLinkToken(null), '')
  assert.equal(normalizeLinkToken(undefined), '')
})

test('Eingaben des Unterzeichners werden gegen die Felddefinition geprueft', () => {
  const fields = [
    field({ id: 'sig', type: 'SIGNATURE', label: 'Unterschrift', required: true }),
    field({ id: 'ok', type: 'CHECKBOX', label: 'Einverstanden', required: true }),
    field({ id: 'tag', type: 'DATE', label: 'Datum' }),
    field({ id: 'note', type: 'LONG_TEXT', label: 'Anmerkung' }),
  ]

  const good = validateContractValues(fields, {
    sig: '  Jane Doe  ',
    ok: true,
    tag: '2026-09-09',
    note: 'passt',
  })
  assert.deepEqual(good.errors, [])
  assert.equal(good.values.sig, 'Jane Doe')
  assert.equal(good.values.ok, true)

  const bad = validateContractValues(fields, { sig: 'JD', ok: false, tag: '09.09.2026' })
  assert.equal(bad.values.ok, false)
  assert.equal(bad.errors.length, 3, bad.errors.join(' | '))
  assert.ok(bad.errors.some((e) => e.includes('vollständigen Namen')))
  assert.ok(bad.errors.some((e) => e.includes('bestätigt')))
  assert.ok(bad.errors.some((e) => e.includes('gültiges Datum')))

  // Ein Pflichtfeld ohne Eingabe meldet genau einen Fehler.
  const empty = validateContractValues([field({ id: 'x', type: 'SHORT_TEXT', label: 'Ort', required: true })], {})
  assert.deepEqual(empty.errors, ['„Ort“ ist erforderlich.'])
})

test('Das erste Unterschriftsfeld liefert den gespeicherten Namen', () => {
  const fields = [
    field({ id: 'a', type: 'SHORT_TEXT', label: 'Ort' }),
    field({ id: 'b', type: 'SIGNATURE', label: 'Erste Unterschrift' }),
    field({ id: 'c', type: 'SIGNATURE', label: 'Zweite Unterschrift' }),
  ]
  assert.equal(primarySignatureField(fields)?.id, 'b')
  assert.equal(primarySignatureField([]), null)
})

test('Felder und Regelungen werden aus JSON robust gelesen', () => {
  // Aus der Datenbank kommt Json - alles muss auch bei Unsinn halten.
  assert.deepEqual(readContractFields(null), [])
  assert.deepEqual(readContractFields('kaputt'), [])
  assert.deepEqual(readContractClauses(undefined), [])

  const sanitized = sanitizeContractFields([
    { id: 'a', type: 'SIGNATURE', label: 'Unterschrift', required: true, sortOrder: 1 },
    { id: 'b', type: 'GIBT_ES_NICHT', label: 'Unbekannt' },
  ])
  assert.equal(sanitized.length, 2)
  assert.equal(sanitized[0]!.type, 'SIGNATURE')
  // Ein unbekannter Typ faellt auf Kurztext zurueck, statt den Vertrag zu sprengen.
  assert.equal(sanitized[1]!.type, 'SHORT_TEXT')
})

test('Status und Feldtypen sind die erwarteten', () => {
  // Der Umbau darf keinen Status verlieren; SIGNED und DECLINED werden
  // kuenftig aus den einzelnen Unterschriften abgeleitet.
  assert.deepEqual([...CONTRACT_STATUSES], ['DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'CANCELLED'])
  assert.deepEqual([...CONTRACT_FIELD_TYPES], ['SHORT_TEXT', 'LONG_TEXT', 'DATE', 'CHECKBOX', 'SIGNATURE'])
})

test('Vertragsdatum wird deutsch formatiert', () => {
  assert.equal(formatContractDate(new Date('2026-09-09T12:00:00Z')), '09.09.2026')
  assert.equal(formatContractDate(null), '')
  assert.equal(formatContractDate('unsinn'), '')
})
