import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyRaidRequest, raidDocument, raidReference } from '../src/lib/investigations/raid-request'
import { raidRequestSchema, readRaidRequest } from '../src/lib/investigations/raid-request-schema'
import { shareSchema } from '../src/lib/investigations/record-share-validation'

const filled = () => ({
  ...emptyRaidRequest('Max Muster'),
  target: 'Anwesen der Familie Moretti',
  address: 'Vinewood Hills',
  offenses: 'Bandenmäßiger Handel mit Betäubungsmitteln',
  facts: 'Am 12.10. wurden Lieferungen beobachtet.\n\nAm 14.10. folgte ein Zugriff.',
  applicantRank: 'Special Agent',
  applicantBadge: 'FIB-12',
})

test('Pflichtangaben werden geprüft', () => {
  assert.equal(raidRequestSchema.safeParse(emptyRaidRequest('Max')).success, false)
  assert.equal(raidRequestSchema.safeParse(filled()).success, true)
  assert.equal(raidRequestSchema.safeParse({ ...filled(), measures: [] }).success, false)
  assert.equal(raidRequestSchema.safeParse({ ...filled(), measures: ['BOMBARD'] }).success, false)
  assert.equal(raidRequestSchema.safeParse({ ...filled(), extra: 1 }).success, false)
  assert.equal(readRaidRequest(null), null)
  assert.equal(readRaidRequest({ target: 'x' }), null)
})

test('Freigabe ohne Antrag bleibt eine normale Freigabe', () => {
  const base = { title: 'T', items: [{ kind: 'CASE', recordId: 'c1' }] }
  assert.equal(shareSchema.parse(base).raidRequest, null)
  assert.ok(shareSchema.parse({ ...base, raidRequest: filled() }).raidRequest)
})

test('Aktenzeichen ist stabil und lesbar', () => {
  assert.equal(raidReference('cm1abcdeXYZ12', new Date(2026, 9, 22)), 'FIB-RA-2026-1022-XYZ12')
})

test('Das Schreiben ist förmlich und vollständig', () => {
  const doc = raidDocument(filled(), {
    reference: 'FIB-RA-1',
    createdAt: new Date(2026, 9, 22),
    attachments: [{ label: 'Dauerakten', title: 'Familie Moretti' }, { label: 'Einzelakten / Einsatzakten', title: 'ERM-0042 · Drogen' }],
  })
  assert.match(doc.preamble, /kraft der mir als Special Agent Max Muster \(Dienstnummer FIB-12\) des Federal Investigation Bureau verliehenen Befugnisse/)
  assert.match(doc.preamble, /im Namen des Federal Investigation Bureau/)
  assert.match(doc.subject, /Anwesen der Familie Moretti/)
  assert.equal(doc.dateLine, 'Los Santos, den 22. Oktober 2026')
  const antrag = doc.sections.find((section) => section.heading === 'I. Antrag')!
  assert.match(antrag.paragraphs[0], /belegen Vinewood Hills/)
  assert.equal(antrag.list?.length, 2)
  const evidence = doc.sections.find((section) => section.heading === 'V. Beweismittel')!
  assert.deepEqual(evidence.list, ['Anlage 1: Dauerakten – Familie Moretti', 'Anlage 2: Einzelakten / Einsatzakten – ERM-0042 · Drogen'])
  assert.deepEqual(doc.sections.find((section) => section.heading === 'IV. Sachverhalt')!.paragraphs.length, 2)
  assert.ok(!doc.sections.some((section) => section.heading.includes('Eilbedürftigkeit')))
  assert.match(doc.closing, /Hochachtungsvoll$/)
})

test('Gefahr im Verzug bekommt einen eigenen Abschnitt', () => {
  const doc = raidDocument({ ...filled(), urgency: 'IMMINENT' }, { reference: 'x', createdAt: new Date(), attachments: [] })
  const urgent = doc.sections.find((section) => section.heading === 'VII. Eilbedürftigkeit')
  assert.ok(urgent)
  assert.match(urgent!.paragraphs[0], /Gefahr im Verzug/)
})
