import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma } from '../src/generated/prisma'
import { corruptionCheckSchema, corruptionQuerySchema, officialNumber, parseOfficialNumber } from '../src/lib/corruption-validation'
import { createCorruptionCheck, officialSearch } from '../src/lib/corruption-server'

const input = () => corruptionCheckSchema.parse({
  requestId: '12bd0238-36f6-42d3-882a-ce9048a5d60a',
  official: { firstName: 'Alex', lastName: 'Miller', agency: 'LSPD', badgeNumber: '42' },
  conductedAt: '2026-01-02T15:30:00+01:00', agentIds: ['agent1', 'agent2'], result: 'FINDINGS', findings: 'Ein nicht registrierter Gegenstand',
})

function fixture() {
  const officials: { id: number; firstName: string; lastName: string; agency: string }[] = []
  const checks: { id: string; requestId: string; createdById: string; officialId: number; findings: string; conductedAt: Date; agents: { create: { agentId: string; name: string; badgeNumber: string }[] } }[] = []
  const audits: unknown[] = []
  const tx = {
    publicOfficial: {
      create: async ({ data }: { data: Omit<typeof officials[number], 'id'> }) => { const person = { ...data, id: officials.length + 1 }; officials.push(person); return person },
      findUnique: async ({ where }: { where: { id: number } }) => officials.find(person => person.id === where.id) ?? null,
    },
    agent: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => ['agent1', 'agent2'].filter(id => where.id.in.includes(id)).map(id => ({ id, firstName: 'Agent', lastName: id, badgeNumber: `FIB-${id}` })) },
    corruptionCheck: {
      findUnique: async ({ where }: { where: { requestId: string } }) => checks.find(check => check.requestId === where.requestId) ?? null,
      create: async ({ data }: { data: Omit<typeof checks[number], 'id'> }) => { const check = { ...data, id: `check-${checks.length + 1}` }; checks.push(check); return check },
    },
    auditLog: { create: async (args: unknown) => { audits.push(args); return args } },
  } as unknown as Prisma.TransactionClient
  return { tx, officials, checks, audits }
}

test('First control creates a numbered official; later controls reuse the same file and snapshot all agents', async () => {
  const f = fixture()
  await createCorruptionCheck(f.tx, input(), 'user')
  assert.equal(officialNumber(f.officials[0].id), 'BEA-000001')
  assert.equal(f.checks[0].conductedAt.toISOString(), '2026-01-02T14:30:00.000Z')
  assert.deepEqual(f.checks[0].agents.create.map(agent => agent.agentId), ['agent1', 'agent2'])
  assert.equal(f.checks[0].agents.create[0].name, 'Agent agent1')
  const next = input()
  delete next.official
  next.officialId = 1
  next.requestId = '6d8916f3-747e-482d-9d8f-e32a1bf66120'
  next.result = 'CLEAR'; next.findings = ''
  await createCorruptionCheck(f.tx, next, 'user')
  assert.equal(f.officials.length, 1)
  assert.equal(f.checks.length, 2)
  assert.equal(f.checks[1].officialId, 1)
  assert.equal(f.checks[1].findings, 'Ohne Befund')
  assert.equal(f.audits.length, 2)
})

test('Retry returns the saved control without a second official, control or audit record', async () => {
  const f = fixture()
  await createCorruptionCheck(f.tx, input(), 'user')
  await createCorruptionCheck(f.tx, input(), 'user')
  assert.equal(f.checks.length, 1); assert.equal(f.officials.length, 1); assert.equal(f.audits.length, 1)
  await assert.rejects(createCorruptionCheck(f.tx, input(), 'other-user'), /bereits verwendet/)
})

test('Missing agents and missing officials do not create a control', async () => {
  const f = fixture()
  await assert.rejects(createCorruptionCheck(f.tx, { ...input(), agentIds: ['missing'] }, 'user'), /existiert nicht/)
  assert.equal(f.officials.length, 0)
  const request = input(); delete request.official; request.officialId = 99
  await assert.rejects(createCorruptionCheck(f.tx, request, 'user'), /nicht gefunden/)
  assert.equal(f.checks.length, 0)
})

test('Input requires one official selection, valid date, agents and a meaningful positive finding', () => {
  const base = input()
  for (const invalid of [
    { ...base, officialId: 1 }, { ...base, official: undefined }, { ...base, agentIds: [] },
    { ...base, result: 'FINDINGS', findings: '  ' }, { ...base, conductedAt: 'invalid' },
    { ...base, conductedAt: new Date(Date.now() + 86400000).toISOString() },
    { ...base, official: { ...base.official, firstName: ' ' } }, { ...base, createdById: 'spoofed' },
  ]) assert.equal(corruptionCheckSchema.safeParse(invalid).success, false)
  assert.deepEqual(corruptionCheckSchema.parse({ ...base, agentIds: ['agent1', 'agent1'] }).agentIds, ['agent1'])
  assert.equal(corruptionQuerySchema.safeParse({ from: '2026-01-03T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success, false)
  assert.equal(corruptionQuerySchema.safeParse({ page: '0' }).success, false)
})

test('Number and multi-part name search work without merging people with equal names', () => {
  assert.equal(parseOfficialNumber('bea-000042'), 42)
  assert.equal(parseOfficialNumber('42'), 42)
  assert.equal(parseOfficialNumber('BEA-0'), null)
  assert.equal(parseOfficialNumber('2147483648'), null)
  assert.deepEqual(officialSearch('BEA-000042'), { id: 42 })
  assert.equal((officialSearch('Alex Miller').AND as unknown[]).length, 2)
})
