import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma } from '../src/generated/prisma'
import { correctReport, correctionSchema, mergeOfficials } from '../src/lib/corruption-edits'
import { resolveOfficial } from '../src/lib/corruption-server'
import { matchesEvidenceType, evidencePath } from '../src/lib/corruption-evidence'
import { resolveBodycamAccess } from '../src/lib/bodycam-access'
import type { CurrentAuth } from '../src/lib/auth'

test('Bodycam role is read-only, excludes classified cases and cannot bypass token scopes', async () => {
  const auth: CurrentAuth = { kind: 'cookie', user: { id: 'u', username: 'user', displayName: 'User', discordId: '123456789012345678', avatarUrl: null, groups: [], permissions: [] } }
  const access = await resolveBodycamAccess(auth, async () => true)
  assert.equal(access.full, false)
  assert.deepEqual(access.where, { classified: false })
  await assert.rejects(resolveBodycamAccess(auth, async () => false), /Forbidden/)
  await assert.rejects(resolveBodycamAccess({ ...auth, kind: 'api' }, async () => true), /Forbidden/)
  await assert.rejects(resolveBodycamAccess(null, async () => true), /Unauthorized/)
  const full = await resolveBodycamAccess({ ...auth, user: { ...auth.user, permissions: ['investigations:view'] } }, async () => { throw new Error('Should not need Discord') })
  assert.equal(full.full, true)
})

test('Merge moves all controls, retains aliases and rejects self/repeated merges', async () => {
  const officials = [{ id: 1, mergedIntoId: null as number | null }, { id: 2, mergedIntoId: null as number | null }, { id: 3, mergedIntoId: 1 as number | null }]
  const checks = [{ officialId: 1 }, { officialId: 1 }, { officialId: 2 }]
  const audits: unknown[] = []
  const tx = {
    publicOfficial: {
      findUnique: async ({ where }: { where: { id: number } }) => officials.find(p => p.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: { mergedIntoId: number } }) => Object.assign(officials.find(p => p.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: { mergedIntoId: number }; data: { mergedIntoId: number } }) => officials.filter(p => p.mergedIntoId === where.mergedIntoId).forEach(p => Object.assign(p, data)),
    },
    corruptionCheck: { updateMany: async ({ where, data }: { where: { officialId: number }; data: { officialId: number } }) => { const matching = checks.filter(c => c.officialId === where.officialId); matching.forEach(c => Object.assign(c, data)); return { count: matching.length } } },
    auditLog: { create: async (data: unknown) => audits.push(data) },
  } as unknown as Prisma.TransactionClient
  await assert.rejects(mergeOfficials(tx, 1, 1, 'Duplicate', { id: 'u', displayName: 'User' }), /unterschiedliche/)
  const result = await mergeOfficials(tx, 1, 2, 'Duplicate', { id: 'u', displayName: 'User' })
  assert.equal(result.moved, 2)
  assert.deepEqual(checks.map(c => c.officialId), [2, 2, 2])
  assert.equal((await resolveOfficial(tx, 3))?.id, 2)
  assert.equal((await resolveOfficial(tx, 1))?.id, 2)
  assert.equal(audits.length, 1)
  await assert.rejects(mergeOfficials(tx, 1, 2, 'Again', { id: 'u', displayName: 'User' }), /bereits/)
})

test('Correction records before/after and actor, keeps historical agent names and rejects stale versions', async () => {
  let check = { id: 'c', version: 1, conductedAt: new Date('2026-01-01T12:00:00Z'), result: 'CLEAR', findings: 'Original', location: null, notes: null, agents: [{ agentId: 'a', name: 'Original Agent', badgeNumber: 'OLD' }, { agentId: null, name: 'Deleted Agent', badgeNumber: 'GONE' }] }
  const revisions: { before: { findings: string }; after: { findings: string }; actorName: string; version: number }[] = []
  const tx = {
    corruptionCheck: {
      findUnique: async () => structuredClone(check),
      updateMany: async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => { if (where.version !== check.version) return { count: 0 }; check = { ...check, ...data, version: check.version + 1 }; return { count: 1 } },
      findUniqueOrThrow: async () => check,
    },
    agent: { findMany: async () => [{ id: 'a', firstName: 'Renamed', lastName: 'Agent', badgeNumber: 'NEW' }] },
    corruptionCheckAgent: { deleteMany: async () => {}, createMany: async ({ data }: { data: typeof check.agents }) => { check.agents = data } },
    corruptionRevision: { create: async ({ data }: { data: typeof revisions[number] }) => revisions.push(data) },
    auditLog: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient
  const input = correctionSchema.parse({ version: 1, reason: 'Tippfehler korrigiert', conductedAt: '2026-01-01T12:00:00Z', agentIds: ['a'], result: 'FINDINGS', findings: 'Korrigiert' })
  await correctReport(tx, 'c', input, { id: 'u', displayName: 'Editor' })
  assert.equal(revisions[0].before.findings, 'Original')
  assert.equal(revisions[0].after.findings, 'Korrigiert')
  assert.equal(revisions[0].actorName, 'Editor')
  assert.equal(revisions[0].version, 2)
  assert.equal(check.agents[0].name, 'Original Agent')
  assert.equal(check.agents[1].name, 'Deleted Agent')
  await assert.rejects(correctReport(tx, 'c', input, { id: 'u', displayName: 'Editor' }), /bereits geändert/)
  assert.equal(revisions.length, 1)
})

test('Evidence uploads reject forged content types and traversal', async () => {
  assert.equal(matchesEvidenceType('application/pdf', Buffer.from('%PDF-1.7')), true)
  assert.equal(matchesEvidenceType('application/pdf', Buffer.from('<html>fake</html>')), false)
  assert.equal(matchesEvidenceType('image/svg+xml', Buffer.from('<svg/>')), false)
  assert.throws(() => evidencePath('../../secret.pdf'))
  // Die Signaturpruefung sitzt jetzt im Chunk-Abschluss; hier bleibt der reine Vorgabentest.
  assert.equal(matchesEvidenceType('image/png', Buffer.from('not a PNG')), false)
  assert.equal(correctionSchema.safeParse({ version: 1, reason: '' }).success, false)
})
