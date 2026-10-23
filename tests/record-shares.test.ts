import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma } from '../src/generated/prisma'
import { createShareToken, resolveShare, tokenHash, validateShareItems, publicShareHeaders } from '../src/lib/investigations/record-shares'
import { expandSharedItems, requireSharedSelection, publicRecord, sharedHeading, sharedPhoto } from '../src/lib/investigations/shared-records-public'
import { shareSchema } from '../src/lib/investigations/record-share-validation'
import type { CurrentUser } from '../src/lib/auth'

test('Share tokens are random and hashed; expired, disabled, replaced and invalid links cannot resolve', async () => {
  const a = createShareToken(), b = createShareToken()
  assert.notEqual(a.token, b.token); assert.equal(a.token.length, 43); assert.equal(a.tokenHash.length, 64)
  assert.equal(tokenHash(a.token), a.tokenHash); assert.notEqual(a.token, a.tokenHash)
  const share = { id: 's', title: 'Share', tokenHash: a.tokenHash, enabled: true, expiresAt: null as Date | null, version: 1, createdById: 'u', createdAt: new Date(), updatedAt: new Date(), raidRequest: null, items: [] }
  const lookup = async (hash: string) => hash === share.tokenHash ? share : null
  assert.equal((await resolveShare(a.token, lookup)).id, 's')
  share.enabled = false
  await assert.rejects(resolveShare(a.token, lookup), /ungültig/)
  share.enabled = true; share.expiresAt = new Date(Date.now() - 1)
  await assert.rejects(resolveShare(a.token, lookup), /ungültig/)
  share.expiresAt = null; share.tokenHash = b.tokenHash
  await assert.rejects(resolveShare(a.token, lookup), /ungültig/)
  assert.equal((await resolveShare(b.token, lookup)).id, 's')
  await assert.rejects(resolveShare('../invalid', lookup), /ungültig/)
})

test('Selection is scoped by both type and ID; unselected children and media do not inherit access', () => {
  const items = [{ kind: 'DOSSIER', recordId: 'parent' }, { kind: 'PERSON', recordId: 'same-id' }]
  assert.equal(requireSharedSelection(items, 'DOSSIER', 'parent').recordId, 'parent')
  for (const [kind, id] of [['DOSSIER', 'child'], ['CLIP', 'parent'], ['VEHICLE', 'same-id'], ['PERSON', 'other']]) assert.throws(() => requireSharedSelection(items, kind, id), /nicht freigegeben/)
})

test('A shared dossier releases all its cases, persons and vehicles', async () => {
  let where: unknown = 'unset'
  const client = { dossier: { findMany: async (args: { select: { investigations: { where?: unknown } } }) => { where = args.select.investigations.where; return [{ investigations: [{ id: 'c1' }], persons: [{ id: 'p1' }], vehicles: [{ id: 'v1' }] }] } }, bodycamClip: { findMany: async () => [] } } as unknown as Prisma.TransactionClient
  const items = [{ kind: 'DOSSIER', recordId: 'd' }, { kind: 'PERSON', recordId: 'p1' }]
  const expanded = await expandSharedItems(items, client)
  assert.deepEqual(expanded.map(i => `${i.kind}:${i.recordId}`), ['DOSSIER:d', 'PERSON:p1', 'CASE:c1', 'VEHICLE:v1'])
  assert.equal(where, undefined)
  assert.equal(requireSharedSelection(expanded, 'CASE', 'c1').recordId, 'c1')
  assert.throws(() => requireSharedSelection(expanded, 'CLIP', 'c1'), /nicht freigegeben/)
  assert.deepEqual(await expandSharedItems([{ kind: 'PERSON', recordId: 'x' }], {} as Prisma.TransactionClient), [{ kind: 'PERSON', recordId: 'x' }])
})

test('Shared cases release their bodycam clips', async () => {
  let where: unknown
  const client = {
    dossier: { findMany: async () => [{ investigations: [{ id: 'c2' }], persons: [], vehicles: [] }] },
    bodycamClip: { findMany: async (args: { where: unknown }) => { where = args.where; return [{ id: 'k1', investigationId: 'c1' }, { id: 'k2', investigationId: 'c2' }] } },
  } as unknown as Prisma.TransactionClient
  const expanded = await expandSharedItems([{ kind: 'CASE', recordId: 'c1' }, { kind: 'DOSSIER', recordId: 'd' }], client)
  assert.deepEqual(where, { investigationId: { in: ['c1', 'c2'] } })
  assert.deepEqual(expanded.filter(i => i.kind === 'CLIP'), [{ kind: 'CLIP', recordId: 'k1' }, { kind: 'CLIP', recordId: 'k2' }])
  assert.equal(requireSharedSelection(expanded, 'CLIP', 'k2').recordId, 'k2')
})

test('Public case projection contains chronology but no unselected relations, creator IDs or internal metadata', async () => {
  const row = { title: 'Visible case', caseNumber: 'ERM-1', summary: 'Summary', status: 'OPEN', createdById: 'secret-user', persons: [{ name: 'hidden-person' }], clips: [{ filename: 'hidden.mp4' }], entries: [{ title: 'Interview', content: 'Text', kind: 'NOTE', occurredAt: new Date('2026-01-01'), createdById: 'secret-user', clips: [{ title: 'hidden-clip' }] }] }
  const client = { investigation: { findUnique: async () => row, findUniqueOrThrow: async () => row } } as unknown as Prisma.TransactionClient
  const result = await publicRecord({ kind: 'CASE', recordId: 'c' }, client)
  const json = JSON.stringify(result)
  assert.match(json, /Interview/); assert.match(json, /Summary/)
  assert.doesNotMatch(json, /secret-user|hidden-person|hidden.mp4|hidden-clip|createdById/)
  assert.equal(await sharedHeading({ kind: 'CASE', recordId: 'c' }, client), 'ERM-1 · Visible case')
})

test('Person links are only exposed when the linked person is part of the same share', async () => {
  const people: Record<string, { personNumber: string; firstName: string; lastName: string }> = { p2: { personNumber: 'PER-2', firstName: 'Shared', lastName: 'Friend' }, p3: { personNumber: 'PER-3', firstName: 'Hidden', lastName: 'Person' } }
  const client = { person: { findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, unknown> }) => {
    if (where.id !== 'p1') return people[where.id] ?? null
    if ('linksFrom' in select) return { dossiers: [], investigations: [], vehiclesOwned: [], linksFrom: [{ toPersonId: 'p2', type: 'FAMILY' }], linksTo: [{ fromPersonId: 'p3', type: 'ASSOCIATE' }] }
    if ('photo' in select) return { photoUrl: null, photo: null }
    return { personNumber: 'PER-1', firstName: 'Main', lastName: 'Person' }
  }, findUniqueOrThrow: async () => ({ alias: null, identifier: null, dateOfBirth: null, phone: null, notes: null, wanted: false, dangerous: false }) } } as unknown as Prisma.TransactionClient
  const shared = [{ kind: 'PERSON', recordId: 'p1' }, { kind: 'PERSON', recordId: 'p2' }]
  const result = await publicRecord(shared[0], client, shared)
  assert.deepEqual(result.related, [{ kind: 'PERSON', label: 'Personenakten · Familie', recordId: 'p2', title: 'PER-2 · Shared Friend' }])
  assert.doesNotMatch(JSON.stringify(result), /Hidden|p3/)
})

test('Public photos only use the selected record catalog photo; arbitrary URLs are not fetched', async () => {
  let photoUrl = 'https://untrusted.example/private.png'
  let reads = 0
  const client = { person: { findUnique: async () => ({ photoUrl }) }, investigationPhoto: { findUnique: async ({ where }: { where: { id: string } }) => { reads++; assert.equal(where.id, 'photo'); return { filename: 'stored.png', mimeType: 'image/png' } } } } as unknown as Prisma.TransactionClient
  const item = { kind: 'PERSON', recordId: 'person' }
  assert.equal(await sharedPhoto(item, client), null); assert.equal(reads, 0)
  photoUrl = '/api/investigations/photos/photo/image'
  assert.equal((await sharedPhoto(item, client))?.filename, 'stored.png')
  assert.equal(reads, 1)
})

test('Share creation rejects inaccessible cases, empty/duplicate selections and invalid categories', async () => {
  const client = { investigation: { findFirst: async () => null } } as unknown as Prisma.TransactionClient
  const user: CurrentUser = { id: 'u', username: 'u', displayName: 'User', discordId: null, avatarUrl: null, groups: [], permissions: ['investigations:manage', 'investigations:view'] }
  await assert.rejects(validateShareItems(client, user, [{ kind: 'CASE', recordId: 'hidden' }]), /nicht mehr zugänglich/)
  for (const items of [[], [{ kind: 'CASE', recordId: 'c' }, { kind: 'CASE', recordId: 'c' }], [{ kind: 'USER', recordId: 'u' }]]) assert.equal(shareSchema.safeParse({ title: 'Share', items }).success, false)
  const headers = publicShareHeaders(new Response()).headers
  assert.match(headers.get('Cache-Control')!, /no-store/)
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer')
  assert.match(headers.get('X-Robots-Tag')!, /noindex/)
})
