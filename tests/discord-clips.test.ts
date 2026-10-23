import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipChannelPositions, syncAgentClipChannel } from '../src/lib/discord/discord-clips'

function fixture() {
  const channels: Record<string, unknown>[] = [{ id: 'category', type: 4, name: 'Clips' }, { id: 'other', type: 4, name: 'Andere Kategorie' }]
  const writes: Record<string, unknown>[] = []
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (init) {
      if (init.method === 'DELETE') {
        const index = channels.findIndex(channel => path === `/channels/${channel.id}`)
        assert.notEqual(index, -1)
        channels.splice(index, 1)
        writes.push({ method: 'DELETE', path })
        return undefined as T
      }
      const payload = JSON.parse(String(init.body))
      writes.push(payload)
      if (init.method === 'POST') channels.push({ id: String(channels.length), ...payload })
      else Object.assign(channels.find(channel => path === `/channels/${channel.id}`)!, payload)
      return channels.at(-1) as T
    }
    if (path.endsWith('/roles')) return [{ id: 'analysts' }, { id: 'new-analysts' }] as T
    if (path === '/users/@me') return { id: 'bot' } as T
    return channels as T
  }
  const agent = { id: 'agent-1', lastName: 'Müller', discordId: 'member', status: 'ACTIVE' }
  const sync = (remove = false, category = 'category', role = 'analysts') => syncAgentClipChannel(request, 'guild', role, agent, remove, category)
  return { channels, writes, agent, sync }
}

test('creates a private upload channel in the selected category and avoids concurrent duplicates', async () => {
  const f = fixture()
  await Promise.all([f.sync(), f.sync()])
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].name, '🔍│müller-clips')
  assert.equal(f.writes[0].parent_id, 'category')
  const permissions = f.writes[0].permission_overwrites as { id: string; allow: string; deny: string }[]
  assert.equal(permissions.find(p => p.id === 'guild')?.deny, '1024')
  for (const id of ['member', 'analysts', 'bot']) {
    const allow = BigInt(permissions.find(p => p.id === id)!.allow)
    assert.equal(allow & (BigInt(1024) | BigInt(2048) | BigInt(32768) | BigInt(65536)), BigInt(1024) | BigInt(2048) | BigInt(32768) | BigInt(65536))
  }
})

test('moves existing channels, updates names and replaces outdated access without deleting clips', async () => {
  const f = fixture()
  await f.sync()
  f.agent.lastName = 'Schmidt'
  f.agent.discordId = 'new-member'
  await f.sync(false, 'other', 'new-analysts')
  assert.equal(f.channels.length, 3)
  assert.equal(f.channels[2].name, '🔍│schmidt-clips')
  assert.equal(f.channels[2].parent_id, 'other')
  assert.deepEqual((f.channels[2].permission_overwrites as { id: string }[]).map(p => p.id), ['guild', 'new-analysts', 'bot', 'new-member'])
  await f.sync(true, 'other', 'new-analysts')
  assert.equal(f.channels.length, 3)
  assert.ok(!(f.channels[2].permission_overwrites as { id: string }[]).some(p => p.id === 'new-member'))
})

test('rejects invalid or full categories and unsafe analyst roles without creating channels', async () => {
  const f = fixture()
  await assert.rejects(f.sync(false, 'missing'), /Kategorie/)
  await assert.rejects(f.sync(false, 'category', 'guild'), /everyone/)
  for (let i = 0; i < 50; i++) f.channels.push({ id: `filler-${i}`, type: 0, parent_id: 'category' })
  await assert.rejects(f.sync(), /voll/)
  assert.equal(f.writes.length, 0)
})

test('termination deletes only the agent channel even without role/category configuration, and is repeatable', async () => {
  const f = fixture()
  await f.sync()
  f.channels.push({ id: 'unrelated', type: 0, name: '🔍│müller-clips', topic: 'fib-agent-clips:someone-else' })
  f.agent.status = 'TERMINATED'
  await f.sync(true, '', '')
  await f.sync(true, '', '')
  assert.deepEqual(f.channels.map(channel => channel.id), ['category', 'other', 'unrelated'])
  assert.equal(f.writes.filter(write => write.method === 'DELETE').length, 1)
})

test('orders clip channels like the roster and leaves other channels alone', () => {
  const clip = (id: string, agentId: string, position: number) => ({ id, type: 0, name: id, topic: `fib-agent-clips:${agentId}`, parent_id: 'category', position })
  const channels = [
    { id: 'info', type: 0, name: 'info', parent_id: 'category', position: 0 },
    clip('c-b', 'b', 1),
    clip('c-a', 'a', 2),
    clip('c-new', 'new', 3),
    clip('c-elsewhere', 'z', 0),
  ]
  channels[4].parent_id = 'other'
  // Neuer Agent steht im Roster zwischen a und b.
  const positions = clipChannelPositions(channels, 'category', ['a', 'new', 'b'])
  assert.deepEqual(positions, [
    { id: 'c-a', position: 1 },
    { id: 'c-new', position: 2 },
    { id: 'c-b', position: 3 },
  ])
  assert.deepEqual(clipChannelPositions(channels, 'category', ['b', 'a', 'new']), [])
})

test('clip order makes duplicate positions strictly ascending', () => {
  const clip = (id: string, agentId: string) => ({ id, type: 0, name: id, topic: `fib-agent-clips:${agentId}`, parent_id: 'category', position: 5 })
  const positions = clipChannelPositions([clip('1', 'b'), clip('2', 'a')], 'category', ['a', 'b'])
  // „2“ behält Platz 5, nur „1“ rückt dahinter.
  assert.deepEqual(positions, [{ id: '1', position: 6 }])
})
