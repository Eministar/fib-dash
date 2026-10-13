import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botPresence, presenceInterval, createPresenceRotation, loadPresenceStats } from '../scripts/discord-presence.cjs'

test('presence rotates through six activities including attribution and real counts', () => {
  const names = Array.from({ length: 6 }, (_, i) => botPresence({}, i * 60_000, {
    activeAgents: 42, completedTrainings: 1234,
  }).activities[0].name)
  assert.equal(new Set(names).size, 6)
  assert.match(names[1], /42 aktive Agents/)
  assert.match(names[4], /1\.234 abgeschlossene Ausbildungen/)
  assert.match(names[5], /by Emin/)
  assert.equal(botPresence({}, 360_000).activities[0].name, names[0])
  assert.match(botPresence({}, 60_000, { activeAgents: 0, completedTrainings: 0 }).activities[0].name, /0 aktive/)
})

test('legacy title improves automatically and custom titles stay bounded', () => {
  assert.equal(botPresence({ DISCORD_BOT_STATUS: 'FIB HR' }, 0).activities[0].name, '🛡️ FIB Dashboard')
  assert.equal(botPresence({ DISCORD_BOT_STATUS: 'Custom' }, 0).activities[0].name, 'Custom')
  assert.equal(Array.from(botPresence({ DISCORD_BOT_STATUS: '😀'.repeat(150) }, 0).activities[0].name).length, 128)
  for (const value of ['0', '-1', 'abc', '29', '3601']) {
    assert.equal(presenceInterval({ DISCORD_BOT_STATUS_INTERVAL_SECONDS: value }), 60_000)
  }
  assert.equal(presenceInterval({ DISCORD_BOT_STATUS_INTERVAL_SECONDS: '30' }), 30_000)
})

test('statistics use aggregate queries with explicit filters', async () => {
  const stats = await loadPresenceStats({
    agent: { count: async (args) => { assert.deepEqual(args, { where: { status: 'ACTIVE' } }); return 12 } },
    agentTraining: { count: async (args) => { assert.deepEqual(args, { where: { completed: true } }); return 30 } },
  })
  assert.deepEqual(stats, { activeAgents: 12, completedTrainings: 30 })
})

test('rotation caches statistics across reconnects, retries failures and stops timers', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  let loads = 0
  const sent: unknown[] = []
  const rotation = createPresenceRotation((payload) => sent.push(payload), {}, async () => {
    loads++
    if (loads > 1) throw new Error('database unavailable')
    return { activeAgents: 12, completedTrainings: 30 }
  })
  t.after(() => rotation.stop())
  rotation.start()
  await Promise.resolve()
  rotation.start()
  t.mock.timers.tick(60_000)
  assert.equal(sent.length, 1)
  assert.equal(loads, 1)
  assert.match(rotation.current().activities[0].name, /12 aktive/)
  t.mock.timers.tick(240_000)
  await Promise.resolve()
  assert.equal(loads, 2)
  t.mock.timers.tick(120_000)
  assert.equal(rotation.current().activities[0].name, '📂 Personalakten & Laufbahnen')
  rotation.stop()
  const count = sent.length
  t.mock.timers.tick(600_000)
  assert.equal(sent.length, count)
  assert.equal(loads, 2)
})
