// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'

import { prisma } from '../src/lib/prisma'
import {
  AgreementError,
  cancelAgreement,
  createAgreement,
  createTemplate,
  declineParty,
  deleteAgreement,
  duplicateAgreement,
  loadPartyByToken,
  regeneratePartyToken,
  releaseAgreement,
  signParty,
  updateAgreement,
  updateTemplate,
} from '../src/lib/agreement-service'
import type { AgreementInput } from '../src/lib/agreements'

const created: string[] = []
const templates: string[] = []
after(async () => {
  await prisma.agreement.deleteMany({ where: { id: { in: created } } })
  await prisma.agreementTemplate.deleteMany({ where: { id: { in: templates } } })
  await prisma.$disconnect()
})

function input(parties = ['FIB', 'LSPD']): AgreementInput {
  return {
    title: `Test ${randomUUID().slice(0, 8)}`,
    letterhead: 'FIB',
    content: 'Präambel',
    clauses: [{ id: 'c1', title: 'Zweck', body: 'Zusammenarbeit', sortOrder: 0 }],
    closing: null,
    templateId: null,
    parties: parties.map((name) => ({ name })),
  }
}

async function make(parties?: string[]) {
  const agreement = await createAgreement(input(parties), null)
  created.push(agreement.id)
  return agreement
}

const sign = (token: string, name = 'Jane Doe') => signParty(token, { name, ip: '127.0.0.1', userAgent: 'test' })

async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (cause) => cause instanceof AgreementError && cause.status === status)
}

test('Ein Vertrag aus einer Vorlage bleibt unverändert, wenn die Vorlage später geändert wird', async () => {
  const template = await createTemplate({ name: 'Vorlage', letterhead: 'NEUTRAL', content: 'Alt', clauses: [], closing: null }, null)
  templates.push(template.id)
  const agreement = await createAgreement({ ...input(), content: template.content, letterhead: 'NEUTRAL', templateId: template.id }, null)
  created.push(agreement.id)
  await updateTemplate(template.id, { name: 'Vorlage', letterhead: 'FIB', content: 'Neu', clauses: [], closing: null })
  const reloaded = await prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } })
  assert.equal(reloaded.content, 'Alt')
  assert.equal(reloaded.letterhead, 'NEUTRAL')
})

test('Bearbeiten behält Tokens bestehender Parteien und ist nach dem Freigeben gesperrt', async () => {
  const agreement = await make()
  const [fib] = agreement.parties
  const updated = await updateAgreement(agreement.id, { ...input(), parties: [{ id: fib.id, name: 'FIB Direktion' }, { name: 'LSMD' }] })
  assert.deepEqual(updated.parties.map((p) => p.name), ['FIB Direktion', 'LSMD'])
  assert.equal(updated.parties[0].token, fib.token)
  await releaseAgreement(agreement.id)
  await rejects(updateAgreement(agreement.id, input()), 409)
  await rejects(deleteAgreement(agreement.id), 409)
})

test('Der Link eines Entwurfs erlaubt keine Unterschrift', async () => {
  const agreement = await make()
  await rejects(sign(agreement.parties[0].token), 409)
})

test('Drei Parteien: SIGNED erst nach der dritten Unterschrift, doppelte Unterschrift wird abgewiesen', async () => {
  const agreement = await make(['A', 'B', 'C'])
  await releaseAgreement(agreement.id)
  const [a, b, c] = agreement.parties
  assert.equal(await sign(a.token), 'OPEN')
  await rejects(sign(a.token), 409)
  assert.equal(await sign(b.token), 'OPEN')
  assert.equal(await sign(c.token), 'SIGNED')
  const party = await loadPartyByToken(a.token)
  assert.equal(party?.signedName, 'Jane Doe')
})

test('Ablehnung setzt DECLINED, danach kann niemand mehr unterschreiben', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  assert.equal(await declineParty(agreement.parties[0].token, 'Nicht einverstanden'), 'DECLINED')
  await rejects(sign(agreement.parties[1].token), 409)
})

test('Neu erzeugter Link macht den alten ungültig; nach Unterschrift ist das gesperrt', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  const [fib, lspd] = agreement.parties
  const fresh = await regeneratePartyToken(agreement.id, fib.id)
  assert.notEqual(fresh, fib.token)
  assert.equal(await loadPartyByToken(fib.token), null)
  assert.equal(await sign(fresh), 'OPEN')
  await rejects(regeneratePartyToken(agreement.id, fib.id), 409)
  await cancelAgreement(agreement.id)
  await rejects(sign(lspd.token), 409)
})

test('Freigeben verlangt einen Entwurf; Duplizieren erzeugt einen neuen Entwurf mit neuen Tokens', async () => {
  const agreement = await make()
  await releaseAgreement(agreement.id)
  await rejects(releaseAgreement(agreement.id), 409)
  const copy = await duplicateAgreement(agreement.id, null)
  created.push(copy.id)
  assert.equal(copy.status, 'DRAFT')
  assert.equal(copy.parties.length, 2)
  assert.notEqual(copy.parties[0].token, agreement.parties[0].token)
})
