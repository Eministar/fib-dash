import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadershipGroupSchema, leadershipGroupVisibility, canManageLeadershipGroups, privateChannelOverwrites, groupEventMessage, groupOverviewMessage } from '../src/lib/leadership-groups'
import { DISCORD_COMPONENTS_V2_FLAG } from '../src/lib/discord-components'
import { activateChangeTracking } from '../src/lib/change-history-context'
import { prepareMutationCapture, type SnapshotClient } from '../src/lib/change-history-tracking'

/** Collects the text of every text display inside the message container. */
function renderComponents(message: { components: unknown[] }): string {
  const texts: string[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const item = node as { type?: number; content?: string; components?: unknown }
    if (item.type === 10 && typeof item.content === 'string') texts.push(item.content)
    if (item.components) walk(item.components)
  }
  walk(message.components)
  return texts.join('\n')
}

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

test('events use the app-wide component message design, not raw embeds', () => {
  const createdAt = new Date('2026-01-02T03:04:05.000Z')
  const added = groupEventMessage({ kind: 'added', text: 'A hat B zur Gruppe hinzugefügt.', createdAt }, 'Nord')
  assert.equal(added.flags, DISCORD_COMPONENTS_V2_FLAG)
  assert.deepEqual(added.allowed_mentions, { parse: [] })
  const text = renderComponents(added)
  assert.match(text, /# ➕ Mitglied hinzugefügt · Nord/)
  assert.match(text, /> A hat B zur Gruppe hinzugefügt\./)
  assert.match(text, new RegExp(`-# <t:${Math.floor(createdAt.getTime() / 1000)}:f>`))
  assert.match(renderComponents(groupEventMessage({ kind: 'removed', text: 'x', createdAt }, 'Nord')), /# ➖ Mitglied entfernt/)
  // An unknown kind must still produce a valid message rather than throw.
  assert.match(renderComponents(groupEventMessage({ kind: 'kaputt', text: 'x', createdAt }, 'Nord')), /# ℹ️ Ermittlungsgruppe/)
})

test('the pinned overview lists every family with its leadership and all members', () => {
  const text = renderComponents(groupOverviewMessage({
    name: 'Nord',
    families: [
      { name: 'Familie Cabrera', leadIds: ['a'] },
      { name: 'Familie Okafor', leadIds: ['a', 'b'] },
      { name: 'Familie Petrov', leadIds: ['weg'] },
    ],
    members: [
      { id: 'a', displayName: 'Alice', discordId: '111111111111111111' },
      { id: 'b', displayName: 'Bob', discordId: null },
    ],
  }))
  assert.match(text, /# 🗂️ Ermittlungsgruppe · Nord/)
  assert.match(text, /\*\*Familie Cabrera\*\* — <@111111111111111111>/)
  // A member without a linked Discord account falls back to the display name.
  assert.match(text, /\*\*Familie Okafor\*\* — <@111111111111111111> & Bob/)
  assert.match(text, /\*\*Familie Petrov\*\* — Nicht mehr in der Gruppe/)
  assert.match(text, /3 Familien · 2 Mitglieder · Stand <t:\d+:f>/)
})

test('an empty overview stays valid so the pinned message can always be written', () => {
  const text = renderComponents(groupOverviewMessage({ name: 'Nord', families: [], members: [] }))
  assert.match(text, /Noch keine Familien zugewiesen\./)
  assert.match(text, /Noch keine Mitglieder\./)
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
