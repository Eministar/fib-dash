import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma } from '../src/generated/prisma'
import { createShareToken, resolveShare, tokenHash, validateShareItems, publicShareHeaders } from '../src/lib/record-shares'
import { requireSharedSelection, publicRecord, sharedHeading, sharedPhoto } from '../src/lib/shared-records-public'
import { shareSchema } from '../src/lib/record-share-validation'
import type { CurrentUser } from '../src/lib/auth'

test('Share tokens are random and hashed; expired, disabled, replaced and invalid links cannot resolve', async () => {
  const a = createShareToken(), b = createShareToken()
  assert.notEqual(a.token, b.token); assert.equal(a.token.length, 43); assert.equal(a.tokenHash.length, 64)
  assert.equal(tokenHash(a.token), a.tokenHash); assert.notEqual(a.token, a.tokenHash)
  const share = { id: 's', title: 'Share', tokenHash: a.tokenHash, enabled: true, expiresAt: null as Date | null, version: 1, createdById: 'u', createdAt: new Date(), updatedAt: new Date(), items: [] }
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

test('Public case projection contains chronology but no unselected relations, creator IDs or internal metadata', async () => {
  const row = { title: 'Visible case', caseNumber: 'ERM-1', classified: false, summary: 'Summary', status: 'OPEN', createdById: 'secret-user', persons: [{ name: 'hidden-person' }], clips: [{ filename: 'hidden.mp4' }], entries: [{ title: 'Interview', content: 'Text', kind: 'NOTE', occurredAt: new Date('2026-01-01'), createdById: 'secret-user', clips: [{ title: 'hidden-clip' }] }] }
  const client = { investigation: { findUnique: async () => row, findUniqueOrThrow: async () => row } } as unknown as Prisma.TransactionClient
  const result = await publicRecord({ kind: 'CASE', recordId: 'c', classifiedAtGrant: false }, client)
  const json = JSON.stringify(result)
  assert.match(json, /Interview/); assert.match(json, /Summary/)
  assert.doesNotMatch(json, /secret-user|hidden-person|hidden.mp4|hidden-clip|createdById/)
  row.classified = true
  assert.equal(await sharedHeading({ kind: 'CASE', recordId: 'c', classifiedAtGrant: false }, client), null)
  assert.notEqual(await sharedHeading({ kind: 'CASE', recordId: 'c', classifiedAtGrant: true }, client), null)
})

test('Public photos only use the selected record catalog photo; arbitrary URLs are not fetched', async () => {
  let photoUrl = 'https://untrusted.example/private.png'
  let reads = 0
  const client = { person: { findUnique: async () => ({ photoUrl }) }, investigationPhoto: { findUnique: async ({ where }: { where: { id: string } }) => { reads++; assert.equal(where.id, 'photo'); return { filename: 'stored.png', mimeType: 'image/png' } } } } as unknown as Prisma.TransactionClient
  const item = { kind: 'PERSON', recordId: 'person', classifiedAtGrant: false }
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
