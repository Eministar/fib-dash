// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomUUID } from 'node:crypto'

import { prisma } from '../src/lib/prisma'
import {
  AgentOfMonthError,
  castAgentOfMonthVote,
  getAgentOfMonthState,
  getAgentOfMonthWins,
  withdrawAgentOfMonthVote,
} from '../src/lib/agent-of-month-server'
import { monthKey, shiftMonthKey } from '../src/lib/agent-of-month'

after(() => prisma.$disconnect())

async function scaffold() {
  const suffix = randomUUID().slice(0, 8)
  const rank = await prisma.rank.create({ data: { name: `Testrang ${suffix}`, sortOrder: 900 } })
  const makeMember = async (name: string) => {
    const user = await prisma.user.create({ data: { username: `aotm-${name}-${suffix}`, displayName: name } })
    const agent = await prisma.agent.create({
      data: { badgeNumber: `T${suffix.slice(0, 3)}${name[0]}`, firstName: name, lastName: 'Test', rankId: rank.id, userId: user.id },
    })
    return { user, agent }
  }
  const alice = await makeMember('Alice')
  const bob = await makeMember('Bob')
  const carol = await makeMember('Carol')
  const visitor = await prisma.user.create({ data: { username: `aotm-visitor-${suffix}`, displayName: 'Besuch' } })

  const members = [alice, bob, carol]
  const cleanup = async () => {
    const userIds = [...members.map((member) => member.user.id), visitor.id]
    await prisma.agentOfMonthVote.deleteMany({ where: { voterId: { in: userIds } } })
    await prisma.agent.deleteMany({ where: { id: { in: members.map((member) => member.agent.id) } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.rank.delete({ where: { id: rank.id } }).catch(() => {})
  }
  return { alice, bob, carol, visitor, cleanup }
}

const asVoter = (user: { id: string }) => ({ id: user.id, discordId: null })

test('Stimme abgeben, ändern und zurückziehen – eine Stimme je Monat', async (t) => {
  const { alice, bob, carol, cleanup } = await scaffold()
  t.after(cleanup)

  await castAgentOfMonthVote(asVoter(alice.user), bob.agent.id)
  let state = await getAgentOfMonthState(asVoter(alice.user))
  assert.equal(state.canVote, true)
  assert.equal(state.myVoteAgentId, bob.agent.id)
  assert.ok(!state.candidates.some((agent) => agent.id === alice.agent.id), 'man steht nicht selbst zur Wahl')

  await castAgentOfMonthVote(asVoter(alice.user), carol.agent.id)
  state = await getAgentOfMonthState(asVoter(alice.user))
  assert.equal(state.myVoteAgentId, carol.agent.id)
  assert.equal(await prisma.agentOfMonthVote.count({ where: { voterId: alice.user.id } }), 1)

  await withdrawAgentOfMonthVote(alice.user.id)
  state = await getAgentOfMonthState(asVoter(alice.user))
  assert.equal(state.myVoteAgentId, null)
})

test('Ohne eigenen Agent und für sich selbst wird nicht abgestimmt', async (t) => {
  const { alice, visitor, cleanup } = await scaffold()
  t.after(cleanup)

  await assert.rejects(castAgentOfMonthVote(asVoter(visitor), alice.agent.id), (e: unknown) => e instanceof AgentOfMonthError && e.status === 403)
  await assert.rejects(castAgentOfMonthVote(asVoter(alice.user), alice.agent.id), AgentOfMonthError)
  assert.equal((await getAgentOfMonthState(asVoter(visitor))).canVote, false)
})

test('Sieger des Vormonats und Siege in der Personalakte', async (t) => {
  const { alice, bob, carol, cleanup } = await scaffold()
  t.after(cleanup)

  const now = new Date()
  const previous = shiftMonthKey(monthKey(now), -1)
  await prisma.agentOfMonthVote.createMany({
    data: [
      { month: previous, voterId: alice.user.id, agentId: carol.agent.id },
      { month: previous, voterId: bob.user.id, agentId: carol.agent.id },
      { month: previous, voterId: carol.user.id, agentId: bob.agent.id },
    ],
  })
  // Laufender Monat zählt noch nicht als Sieg.
  await castAgentOfMonthVote(asVoter(alice.user), bob.agent.id)

  const state = await getAgentOfMonthState(asVoter(alice.user), now)
  const ours = state.winners.filter((agent) => [alice.agent.id, bob.agent.id, carol.agent.id].includes(agent.id))
  assert.deepEqual(ours.map((agent) => [agent.id, agent.votes]), [[carol.agent.id, 2]])

  assert.deepEqual(await getAgentOfMonthWins(carol.agent.id, now), [previous])
  assert.deepEqual(await getAgentOfMonthWins(bob.agent.id, now), [])
})
