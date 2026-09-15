import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agreementInputSchema, deriveAgreementStatus, linkActionSchema } from '../src/lib/agreements'
import { loadPartyByToken, type LinkParty } from '../src/lib/agreement-service'

const open = { signedAt: null, declinedAt: null }
const signed = { signedAt: new Date(), declinedAt: null }
const declined = { signedAt: null, declinedAt: new Date() }

test('Ein offener Vertrag ist erst unterschrieben, wenn alle Parteien unterschrieben haben', () => {
  assert.equal(deriveAgreementStatus('OPEN', [signed, open, signed]), 'OPEN')
  assert.equal(deriveAgreementStatus('OPEN', [signed, signed, signed]), 'SIGNED')
})

test('Eine Ablehnung setzt den Vertrag auf DECLINED, andere Status bleiben unberührt', () => {
  assert.equal(deriveAgreementStatus('OPEN', [signed, declined]), 'DECLINED')
  assert.equal(deriveAgreementStatus('DRAFT', [signed]), 'DRAFT')
  assert.equal(deriveAgreementStatus('CANCELLED', [signed]), 'CANCELLED')
  assert.equal(deriveAgreementStatus('OPEN', []), 'OPEN')
})

test('Eingaben: Titel und mindestens eine Partei sind Pflicht', () => {
  const base = { title: 'Kooperation', content: '', clauses: [], parties: [{ name: 'LSPD' }] }
  assert.equal(agreementInputSchema.safeParse(base).success, true)
  assert.equal(agreementInputSchema.parse(base).letterhead, 'FIB')
  assert.equal(agreementInputSchema.safeParse({ ...base, title: '  ' }).success, false)
  assert.equal(agreementInputSchema.safeParse({ ...base, parties: [] }).success, false)
  assert.equal(agreementInputSchema.safeParse({ ...base, letterhead: 'LSPD' }).success, false)
})

test('Unterschrift braucht vollständigen Namen und Lesebestätigung, Ablehnen nicht', () => {
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jo', confirmed: true }).success, false)
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jane Doe', confirmed: false }).success, false)
  assert.equal(linkActionSchema.safeParse({ action: 'sign', name: 'Jane Doe', confirmed: true }).success, true)
  assert.equal(linkActionSchema.safeParse({ action: 'decline' }).success, true)
})

test('Ein Token mit abweichender Groß-/Kleinschreibung führt nie zu einer Partei', async () => {
  const stored = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE'
  const lookup = async () => ({ token: stored }) as unknown as LinkParty
  assert.equal(await loadPartyByToken(stored.toLowerCase(), lookup), null)
  assert.notEqual(await loadPartyByToken(stored, lookup), null)
  assert.notEqual(await loadPartyByToken(`https://x.example/unterschrift/${stored}.`, lookup), null)
  assert.equal(await loadPartyByToken('', lookup), null)
})
