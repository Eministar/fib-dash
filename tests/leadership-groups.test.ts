import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadershipGroupSchema, leadershipGroupVisibility, canManageLeadershipGroups, privateChannelOverwrites, groupEventEmbed } from '../src/lib/leadership-groups'
import { activateChangeTracking } from '../src/lib/change-history-context'
import { prepareMutationCapture, type SnapshotClient } from '../src/lib/change-history-tracking'

test('ordinary agents and other department managers only query their own memberships', () => {
  for (const permissions of [[], ['agents:view', 'logs:view'], ['unit-leadership:manage'], ['investigations:manage']]) {
    assert.equal(canManageLeadershipGroups({ permissions }), false)
    assert.deepEqual(leadershipGroupVisibility({ id: 'self', permissions }), { members: { some: { userId: 'self' } } })
  }
  assert.deepEqual(leadershipGroupVisibility({ id: 'leader', permissions: ['leadership-groups:manage'] }), {})
})

test('two members may each lead multiple manually named families, including joint leadership', () => {
  assert.equal(leadershipGroupSchema.safeParse({
    name: 'Nord', memberIds: ['a', 'b'], families: [
      { name: 'Familie Cabrera', leadIds: ['a'] }, { name: 'Familie Petrov', leadIds: ['b'] },
      { name: 'Familie Okafor', leadIds: ['a', 'b'] }, { name: 'Familie Lombardi', leadIds: ['a'] },
    ],
  }).success, true)
})

test('rejects nonmember, duplicate, missing and more than two leads', () => {
  for (const leadIds of [[], ['a', 'a'], ['outsider'], ['a', 'b', 'c']]) {
    assert.equal(leadershipGroupSchema.safeParse({ name: 'Nord', memberIds: ['a', 'b', 'c'], families: [{ name: 'Familie Cabrera', leadIds }] }).success, false)
  }
})

test('rejects duplicate or blank family names, duplicate members and empty group names', () => {
  const base = { name: 'Nord', memberIds: ['a'], families: [{ name: 'Familie Cabrera', leadIds: ['a'] }] }
  for (const input of [
    { ...base, name: ' ' },
    { ...base, memberIds: ['a', 'a'] },
    { ...base, families: [...base.families, { name: ' familie cabrera ', leadIds: ['a'] }] },
    { ...base, families: [{ name: '   ', leadIds: ['a'] }] },
  ]) {
    assert.equal(leadershipGroupSchema.safeParse(input).success, false)
  }
})

test('accepts an existing channel id and an empty field, rejects anything else', () => {
  const base = { name: 'Nord', memberIds: ['a'], families: [{ name: 'Familie Cabrera', leadIds: ['a'] }] }
  for (const channelId of ['', '123456789012345678', undefined]) {
    assert.equal(leadershipGroupSchema.safeParse({ ...base, channelId }).success, true)
  }
  for (const channelId of ['12345', 'nicht-numerisch', '1234567890123456789012345']) {
    assert.equal(leadershipGroupSchema.safeParse({ ...base, channelId }).success, false)
  }
})

test('Discord overwrites deny everyone and give access only to bot and current members', () => {
  const overwrites = privateChannelOverwrites('guild', 'bot', ['a', 'b', 'a'])
  assert.deepEqual(overwrites.map(o => o.id), ['guild', 'bot', 'a', 'b'])
  assert.equal(BigInt(overwrites[0].deny) & BigInt(1024), BigInt(1024))
  assert.ok(overwrites.slice(1).every(o => o.type === 1 && (BigInt(o.allow) & BigInt(1024)) === BigInt(1024)))
  assert.equal(privateChannelOverwrites('guild', 'bot', ['b']).some(o => o.id === 'a'), false)
  // Deleting a group withdraws every member grant while the bot keeps access.
  assert.deepEqual(privateChannelOverwrites('guild', 'bot', []).map(o => o.id), ['guild', 'bot'])
})

test('events are delivered as embeds with their own title, colour and group footer', () => {
  const createdAt = new Date('2026-01-02T03:04:05.000Z')
  const added = groupEventEmbed({ kind: 'added', text: 'A hat B zur Gruppe hinzugefügt.', createdAt }, 'Nord')
  assert.equal(added.title, 'Mitglied hinzugefügt')
  assert.equal(added.description, 'A hat B zur Gruppe hinzugefügt.')
  assert.equal(added.footer.text, 'Ermittlungsgruppe Nord')
  assert.equal(added.timestamp, createdAt.toISOString())
  assert.notEqual(added.color, groupEventEmbed({ kind: 'removed', text: 'x', createdAt }, 'Nord').color)
  // An unknown kind must still produce a valid embed rather than throw.
  assert.equal(groupEventEmbed({ kind: 'kaputt', text: 'x', createdAt }, 'Nord').title, 'Ermittlungsgruppe')
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
