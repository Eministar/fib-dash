import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadershipGroupSchema, leadershipGroupVisibility, canManageLeadershipGroups, privateChannelOverwrites } from '../src/lib/leadership-groups'
import { activateChangeTracking } from '../src/lib/change-history-context'
import { prepareMutationCapture, type SnapshotClient } from '../src/lib/change-history-tracking'

test('ordinary agents and other department managers only query their own memberships', () => {
  for (const permissions of [[], ['agents:view', 'logs:view'], ['unit-leadership:manage'], ['investigations:manage']]) {
    assert.equal(canManageLeadershipGroups({ permissions }), false)
    assert.deepEqual(leadershipGroupVisibility({ id: 'self', permissions }), { members: { some: { userId: 'self' } } })
  }
  assert.deepEqual(leadershipGroupVisibility({ id: 'leader', permissions: ['leadership-groups:manage'] }), {})
})

test('two members may each lead multiple families, including joint leadership', () => {
  assert.equal(leadershipGroupSchema.safeParse({
    name: 'Nord', memberIds: ['a', 'b'], families: [
      { dossierId: '1', leadIds: ['a'] }, { dossierId: '2', leadIds: ['b'] },
      { dossierId: '3', leadIds: ['a', 'b'] }, { dossierId: '4', leadIds: ['a'] },
    ],
  }).success, true)
})

test('rejects nonmember, duplicate, missing and more than two leads', () => {
  for (const leadIds of [[], ['a', 'a'], ['outsider'], ['a', 'b', 'c']]) {
    assert.equal(leadershipGroupSchema.safeParse({ name: 'Nord', memberIds: ['a', 'b', 'c'], families: [{ dossierId: '1', leadIds }] }).success, false)
  }
})

test('rejects duplicate families, duplicate members and empty names', () => {
  const base = { name: 'Nord', memberIds: ['a'], families: [{ dossierId: '1', leadIds: ['a'] }] }
  for (const input of [{ ...base, name: ' ' }, { ...base, memberIds: ['a', 'a'] }, { ...base, families: [...base.families, ...base.families] }]) {
    assert.equal(leadershipGroupSchema.safeParse(input).success, false)
  }
})

test('Discord overwrites deny everyone and give access only to bot and current members', () => {
  const overwrites = privateChannelOverwrites('guild', 'bot', ['a', 'b', 'a'])
  assert.deepEqual(overwrites.map(o => o.id), ['guild', 'bot', 'a', 'b'])
  assert.equal(BigInt(overwrites[0].deny) & BigInt(1024), BigInt(1024))
  assert.ok(overwrites.slice(1).every(o => o.type === 1 && (BigInt(o.allow) & BigInt(1024)) === BigInt(1024)))
  assert.equal(privateChannelOverwrites('guild', 'bot', ['b']).some(o => o.id === 'a'), false)
})

test('confidential models never enter automatic history even with active tracking', async () => {
  activateChangeTracking({ changeSetId: 'test-secret', userId: 'leader' })
  const client = new Proxy({}, { get() { throw new Error('History must not read confidential snapshots') } }) as SnapshotClient
  for (const model of ['LeadershipGroup', 'LeadershipGroupMember', 'LeadershipGroupEvent']) {
    for (const operation of ['create', 'update', 'delete', 'createMany', 'deleteMany']) {
      assert.equal(await prepareMutationCapture({ client, model, operation, args: {} }), null)
    }
  }
})
