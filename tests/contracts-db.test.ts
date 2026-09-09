// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

/**
 * Charakterisierungstests der Zustandsübergänge — sie schreiben fest, wie sich
 * das Vertragssystem HEUTE verhält, bevor die Unterschriften in ein eigenes
 * Modell wandern. Schlägt hier nach dem Umbau etwas fehl, ist die Migration
 * schuld.
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'

import { prisma } from '../src/lib/prisma'
import { createContractForAgent } from '../src/lib/contract-service'
import { loadContractByToken } from '../src/lib/contract-links'
import { readContractClauses } from '../src/lib/contracts'

after(() => prisma.$disconnect())

async function scaffold() {
  const suffix = randomUUID().slice(0, 8)
  const rank = await prisma.rank.create({
    data: { name: `Testrang ${suffix}`, sortOrder: 900 },
  })
  const agent = await prisma.agent.create({
    data: {
      badgeNumber: `T${suffix.slice(0, 4)}`,
      firstName: 'Jane',
      lastName: 'Doe',
      rankId: rank.id,
      discordId: `discord-${suffix}`,
      hireDate: new Date('2026-03-04T00:00:00Z'),
    },
    include: { rank: true },
  })
  const template = await prisma.contractTemplate.create({
    data: {
      name: `Vorlage ${suffix}`,
      content: 'Vertrag mit {{name}}, Dienstnummer {{dienstnummer}}. Ausgestellt {{ort}}, {{datum}}.',
      clauses: [{ id: 'c1', title: 'Regelung {{rang}}', body: 'Gilt ab {{einstellungsdatum}}.', sortOrder: 0 }],
      closing: 'Schluss für {{vorname}}.',
      fields: [{ id: 'sig', type: 'SIGNATURE', label: 'Unterschrift', required: true, sortOrder: 0 }],
      active: true,
    },
  })

  const cleanup = async () => {
    await prisma.contract.deleteMany({ where: { agentId: agent.id } })
    await prisma.contractTemplate.delete({ where: { id: template.id } }).catch(() => {})
    await prisma.agent.delete({ where: { id: agent.id } }).catch(() => {})
    await prisma.rank.delete({ where: { id: rank.id } }).catch(() => {})
  }

  return { agent, template, cleanup }
}

test('Ein Vertrag friert die Vorlage ein und loest die Agent-Platzhalter sofort auf', async (t) => {
  const { agent, template, cleanup } = await scaffold()
  t.after(cleanup)

  const contract = await createContractForAgent({
    templateId: template.id,
    agent,
    createdById: null,
  })

  // Agent-Platzhalter sind aufgeloest ...
  assert.match(contract.content, /Vertrag mit Jane Doe/)
  assert.match(contract.content, /Dienstnummer T/)
  // ... Ort und Datum bewusst nicht.
  assert.match(contract.content, /\{\{ort\}\}, \{\{datum\}\}/)

  const clauses = readContractClauses(contract.clauses)
  assert.equal(clauses.length, 1)
  assert.match(clauses[0]!.title, /Regelung Testrang/)
  assert.match(clauses[0]!.body, /Gilt ab 04\.03\.2026\./)
  assert.match(contract.closing ?? '', /Schluss für Jane\./)

  assert.equal(contract.status, 'DRAFT')
  assert.ok(contract.token && contract.token.length >= 16, 'Token wird erzeugt')
  assert.equal(contract.signerDiscordId, agent.discordId)

  // Die Vorlage aendert sich — der bestehende Vertrag darf davon nichts merken.
  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: { content: 'KOMPLETT ANDERS', closing: 'ANDERS' },
  })
  const reloaded = await prisma.contract.findUnique({ where: { id: contract.id } })
  assert.match(reloaded!.content, /Vertrag mit Jane Doe/)
  assert.doesNotMatch(reloaded!.content, /KOMPLETT ANDERS/)
})

test('Ein Token mit abweichender Gross-/Kleinschreibung fuehrt nicht auf den Vertrag', async (t) => {
  const { agent, template, cleanup } = await scaffold()
  t.after(cleanup)

  const contract = await createContractForAgent({ templateId: template.id, agent, createdById: null })

  const exact = await loadContractByToken(contract.token)
  assert.equal(exact?.id, contract.id)

  // MySQL vergleicht Strings standardmaessig ohne Ruecksicht auf Gross- und
  // Kleinschreibung; ohne die zusaetzliche Pruefung zeigte ein veraenderter
  // Token auf einen fremden Vertrag.
  const flipped = contract.token
    .split('')
    .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
    .join('')
  if (flipped !== contract.token) {
    assert.equal(await loadContractByToken(flipped), null)
  }

  assert.equal(await loadContractByToken(''), null)
  assert.equal(await loadContractByToken('gibtesnicht'), null)
})

test('Jeder Vertrag bekommt seinen eigenen Token', async (t) => {
  const { agent, template, cleanup } = await scaffold()
  t.after(cleanup)

  const first = await createContractForAgent({ templateId: template.id, agent, createdById: null })
  const second = await createContractForAgent({ templateId: template.id, agent, createdById: null })
  assert.notEqual(first.token, second.token)
})

test('Die Migration uebertraegt Token und Signaturdaten unveraendert', async (t) => {
  const { agent, template, cleanup } = await scaffold()
  t.after(cleanup)

  const contract = await createContractForAgent({ templateId: template.id, agent, createdById: null })
  const signedAt = new Date('2026-05-01T10:00:00Z')
  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: 'SIGNED',
      signedAt,
      signedName: 'Jane Doe',
      signedIp: '203.0.113.7',
      signedUserAgent: 'Testbrowser',
      values: { sig: 'Jane Doe' },
    },
  })

  const { migrateContractSignatures } = await import('../src/lib/contract-signature-migration')
  const written = await migrateContractSignatures()
  assert.ok(written >= 1)

  const rows = await prisma.contractSignature.findMany({ where: { contractId: contract.id } })
  assert.equal(rows.length, 1, 'genau eine Zeile je Altvertrag')

  const row = rows[0]!
  // Der Link muss weiter funktionieren - er ist womoeglich schon verschickt.
  assert.equal(row.token, contract.token)
  assert.equal(row.signerDiscordId, agent.discordId)
  assert.equal(row.signedName, 'Jane Doe')
  assert.equal(row.signedAt?.getTime(), signedAt.getTime())
  assert.equal(row.signedIp, '203.0.113.7')
  assert.equal(row.signedUserAgent, 'Testbrowser')
  assert.deepEqual(row.values, { sig: 'Jane Doe' })
  assert.match(row.partyName, /Jane Doe/)

  // Wiederholbar: ein zweiter Lauf legt keine Dublette an.
  await migrateContractSignatures()
  assert.equal((await prisma.contractSignature.count({ where: { contractId: contract.id } })), 1)
})

test('Zwei Parteien: erst beide Unterschriften schliessen den Vertrag', async (t) => {
  const { createAgencyContract, loadSignatureByToken, signWithToken } = await import(
    '../src/lib/contract-signature-service'
  )

  const contract = await createAgencyContract({
    title: 'Kooperationsvereinbarung',
    content: 'Zwischen den Behörden.',
    clauses: [{ id: 'c1', title: 'Zusammenarbeit', body: 'Gilt ab sofort.', sortOrder: 0 }],
    closing: null,
    fields: [{ id: 'sig', type: 'SIGNATURE', label: 'Unterschrift', required: true, sortOrder: 0 }],
    ownParty: { partyName: 'Federal Investigation Bureau', partyRole: 'Direktor', signerDiscordId: null },
    counterparty: { partyName: 'Los Santos Police Department', partyRole: 'Chief' },
    createdById: null,
  })
  t.after(() => prisma.contract.delete({ where: { id: contract.id } }).catch(() => {}))

  assert.equal(contract.kind, 'AGENCY')
  assert.equal(contract.agentId, null)
  assert.equal(contract.counterpartyName, 'Los Santos Police Department')

  const rows = await prisma.contractSignature.findMany({
    where: { contractId: contract.id },
    orderBy: { sortOrder: 'asc' },
  })
  assert.equal(rows.length, 2, 'je Seite eine Zeile')
  assert.equal(rows[0]!.side, 'INTERNAL')
  assert.equal(rows[1]!.side, 'EXTERNAL')
  assert.notEqual(rows[0]!.token, rows[1]!.token, 'jede Seite hat ihren eigenen Link')

  // Der Token findet genau seine eigene Zeile.
  const found = await loadSignatureByToken(rows[1]!.token)
  assert.equal(found?.signature.id, rows[1]!.id)
  assert.equal(found?.contract.id, contract.id)
  assert.equal(found?.siblings.length, 1, 'die Gegenseite ist sichtbar')

  // Eine Unterschrift genügt noch nicht.
  await signWithToken(rows[1]!.token, {
    values: { sig: 'Chief Miller' },
    signedName: 'Chief Miller',
    userId: null,
    ip: '203.0.113.9',
    userAgent: 'Testbrowser',
  })
  let reloaded = await prisma.contract.findUnique({ where: { id: contract.id } })
  assert.equal(reloaded!.status, 'SENT', 'eine von zwei reicht nicht')

  // Die zweite schliesst ihn.
  await signWithToken(rows[0]!.token, {
    values: { sig: 'Direktor Vance' },
    signedName: 'Direktor Vance',
    userId: null,
    ip: null,
    userAgent: null,
  })
  reloaded = await prisma.contract.findUnique({ where: { id: contract.id } })
  assert.equal(reloaded!.status, 'SIGNED')

  // Jede Zeile traegt ihre eigene Beweissicherung.
  const after = await prisma.contractSignature.findMany({ where: { contractId: contract.id }, orderBy: { sortOrder: 'asc' } })
  assert.equal(after[1]!.signedName, 'Chief Miller')
  assert.equal(after[1]!.signedIp, '203.0.113.9')
  assert.equal(after[0]!.signedName, 'Direktor Vance')
  assert.equal(after[0]!.signedIp, null)
  assert.deepEqual(after[0]!.values, { sig: 'Direktor Vance' })
})

test('Lehnt eine Partei ab, kommt der Vertrag nicht zustande', async (t) => {
  const { createAgencyContract, declineWithToken, signWithToken } = await import(
    '../src/lib/contract-signature-service'
  )

  const contract = await createAgencyContract({
    title: 'Abgelehnte Vereinbarung',
    content: 'Text.',
    clauses: [],
    closing: null,
    fields: [{ id: 'sig', type: 'SIGNATURE', label: 'Unterschrift', required: true, sortOrder: 0 }],
    ownParty: { partyName: 'FIB', partyRole: null, signerDiscordId: null },
    counterparty: { partyName: 'LSPD', partyRole: null },
    createdById: null,
  })
  t.after(() => prisma.contract.delete({ where: { id: contract.id } }).catch(() => {}))

  const rows = await prisma.contractSignature.findMany({
    where: { contractId: contract.id },
    orderBy: { sortOrder: 'asc' },
  })

  await signWithToken(rows[0]!.token, {
    values: { sig: 'Direktor Vance' },
    signedName: 'Direktor Vance',
    userId: null,
    ip: null,
    userAgent: null,
  })
  await declineWithToken(rows[1]!.token, 'Bedingungen nicht tragbar')

  const reloaded = await prisma.contract.findUnique({ where: { id: contract.id } })
  // Eine Ablehnung wiegt schwerer als die bereits geleistete Unterschrift.
  assert.equal(reloaded!.status, 'DECLINED')

  const declined = await prisma.contractSignature.findUnique({ where: { id: rows[1]!.id } })
  assert.equal(declined!.declineReason, 'Bedingungen nicht tragbar')
  assert.ok(declined!.declinedAt)
})

test('Ein unbekannter oder falsch geschriebener Token findet nichts', async () => {
  const { loadSignatureByToken } = await import('../src/lib/contract-signature-service')
  assert.equal(await loadSignatureByToken(''), null)
  assert.equal(await loadSignatureByToken('gibtesnicht'), null)
})
