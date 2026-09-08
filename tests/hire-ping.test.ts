import assert from 'node:assert/strict'
import { test } from 'node:test'
import { performHirePing, type HirePingDependencies } from '../src/lib/hire-ping'

test('Hiring pings the hired agent once, waits, deletes only its own message and does not repeat the same hire', async () => {
  const claimed = new Set<string>()
  const calls: string[] = []
  const deps: HirePingDependencies = {
    claim: async id => { if (claimed.has(id)) return false; claimed.add(id); return true },
    post: async (channel, user, nonce) => { assert.equal(channel, '123456789012345678'); assert.equal(user, '223456789012345678'); assert.equal(nonce.length, 24); calls.push('post'); return { id: 'message' } },
    rememberDelete: async () => { calls.push('remember') },
    pause: async () => { calls.push('pause') },
    remove: async (_channel, id) => { assert.equal(id, 'message'); calls.push('delete') },
    forgetDelete: async () => { calls.push('forget') },
  }
  await performHirePing('agent', '123456789012345678', '223456789012345678', deps)
  await performHirePing('agent', '123456789012345678', '223456789012345678', deps)
  assert.deepEqual(calls, ['post', 'remember', 'pause', 'delete', 'forget'])
  // Ohne Channel oder ohne Discord-ID des Agents darf gar nichts passieren.
  await performHirePing('another', '', '', deps)
  assert.equal(claimed.has('another'), false)
  await performHirePing('third', '123456789012345678', '', deps)
  assert.equal(claimed.has('third'), false)
})

test('Failed deletion retains the durable cleanup record', async () => {
  let retained = false
  await assert.rejects(performHirePing('agent', '123456789012345678', '223456789012345678', {
    claim: async () => true, post: async () => ({ id: 'm' }),
    rememberDelete: async () => { retained = true }, pause: async () => {},
    remove: async () => { throw new Error('Discord unavailable') }, forgetDelete: async () => { retained = false },
  }), /Discord unavailable/)
  assert.equal(retained, true)
})
