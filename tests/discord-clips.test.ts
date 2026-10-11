import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncAgentClipChannel } from '../src/lib/discord-clips'

function fixture() {
  const channels: Record<string, unknown>[] = [{ id: 'category', type: 4, name: 'Clips' }, { id: 'other', type: 4, name: 'Andere Kategorie' }]
  const writes: Record<string, unknown>[] = []
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (init) {
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
