import assert from 'node:assert/strict'
import { test } from 'node:test'
import { performHirePing, type HirePingDependencies } from '../src/lib/hire-ping'

test('Hiring pings once, waits, deletes only its own message and does not repeat the same hire', async () => {
  const claimed = new Set<string>()
  const calls: string[] = []
  const deps: HirePingDependencies = {
    claim: async id => { if (claimed.has(id)) return false; claimed.add(id); return true },
    post: async (channel, role, nonce) => { assert.equal(channel, '123456789012345678'); assert.equal(role, '223456789012345678'); assert.equal(nonce.length, 24); calls.push('post'); return { id: 'message' } },
    rememberDelete: async () => { calls.push('remember') },
    pause: async () => { calls.push('pause') },
    remove: async (_channel, id) => { assert.equal(id, 'message'); calls.push('delete') },
    forgetDelete: async () => { calls.push('forget') },
  }
  await performHirePing('agent', '123456789012345678', '223456789012345678', deps)
  await performHirePing('agent', '123456789012345678', '223456789012345678', deps)
  assert.deepEqual(calls, ['post', 'remember', 'pause', 'delete', 'forget'])
  await performHirePing('another', '', '', deps)
  assert.equal(claimed.has('another'), false)
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
