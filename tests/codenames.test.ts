import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import type { Prisma } from '../src/generated/prisma'
import { assignCodenameInTransaction, closeCodenameAssignment, releaseTerminatedCodename } from '../src/lib/codenames'
import { codenameBoardPages, reconcileCodenameMessages } from '../src/lib/codename-board'
import { assignCodenameSchema, codenameQuerySchema, createCodenameSchema, releaseCodenameSchema } from '../src/lib/codename-validation'
import { normalizePermissions } from '../src/lib/permissions'

// Small transaction double: tests execute the production transition functions.
// Real MariaDB isolation / deadlock handling needs the deployment smoke test.
function fixture() {
  const agents = [{ id: 'a', firstName: 'Alex', lastName: 'Miller', badgeNumber: 'FIB-001', status: 'ACTIVE' }, { id: 'b', firstName: 'Sam', lastName: 'Reyes', badgeNumber: 'FIB-002', status: 'ACTIVE' }]
  const names = [{ id: 'ghost', name: 'Ghost', retired: false, currentAgentId: null as string | null }, { id: 'raven', name: 'Raven', retired: false, currentAgentId: null as string | null }]
  type Assignment = { id: string; codenameId: string; agentId: string; releasedAt: Date | null; releaseReason?: string; assignedById: string; releasedById?: string; note?: string | null }
  const history: Assignment[] = []
  const audit: { action: string; agentId: string | null }[] = []
  const tx = {
    $queryRaw: async () => [],
    agent: { findUnique: async ({ where }: { where: { id: string } }) => agents.find(a => a.id === where.id) ?? null },
    codename: {
      findUnique: async ({ where }: { where: { id?: string; currentAgentId?: string } }) => {
        const name = names.find(n => where.id ? n.id === where.id : n.currentAgentId === where.currentAgentId)
        return name ? { ...name, currentAgent: agents.find(a => a.id === name.currentAgentId) ?? null } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<typeof names[number]> }) => {
        if (data.currentAgentId && names.some(n => n.id !== where.id && n.currentAgentId === data.currentAgentId)) throw new Error('Unique holder violated')
        const name = names.find(n => n.id === where.id)!
        Object.assign(name, data)
        return { ...name }
      },
    },
    codenameAssignment: {
      findMany: async ({ where }: { where: { codenameId: string } }) => history.filter(h => h.codenameId === where.codenameId && !h.releasedAt),
      create: async ({ data }: { data: Omit<Assignment, 'id' | 'releasedAt'> }) => { const entry = { ...data, id: String(history.length), releasedAt: null }; history.push(entry); return entry },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Assignment> }) => Object.assign(history.find(h => h.id === where.id)!, data),
    },
    auditLog: { create: async ({ data }: { data: typeof audit[number] }) => { audit.push(data); return data } },
  } as unknown as Prisma.TransactionClient
  return { tx, agents, names, history, audit }
}

test('assignment is idempotent and moving an agent releases their old alias before claiming the new one', async () => {
  const f = fixture()
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user', note: 'Erste Vergabe' })
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user' })
  assert.equal(f.history.length, 1)
  await assignCodenameInTransaction(f.tx, { codenameId: 'raven', agentId: 'a', actorId: 'user' })
  assert.equal(f.names[0].currentAgentId, null)
  assert.equal(f.names[1].currentAgentId, 'a')
  assert.equal(f.history[0].releaseReason, 'REASSIGNED')
  assert.equal(f.history[0].note, 'Erste Vergabe')
  assert.equal(f.history.filter(h => !h.releasedAt).length, 1)
})

test('force is explicit; forced takeover closes both displaced assignments with audit attribution', async () => {
  const f = fixture()
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user' })
  await assignCodenameInTransaction(f.tx, { codenameId: 'raven', agentId: 'b', actorId: 'user' })
  await assert.rejects(assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'b', actorId: 'user' }), /Alex Miller/)
  assert.equal(f.history.length, 2)
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'b', actorId: 'user', force: true })
  assert.deepEqual(f.names.map(n => n.currentAgentId), ['b', null])
  assert.deepEqual(f.history.map(h => h.releaseReason), ['REASSIGNED', 'REASSIGNED', undefined])
  assert.equal(f.audit.filter(a => a.action === 'CODENAME_RELEASED').length, 2)
  assert.equal(f.audit.at(-1)?.action, 'CODENAME_REASSIGNED')
})

test('retired aliases and terminated or missing agents cannot be assigned', async () => {
  const f = fixture()
  f.names[0].retired = true
  await assert.rejects(assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user', force: true }), /gesperrt/)
  f.agents[0].status = 'TERMINATED'
  await assert.rejects(assignCodenameInTransaction(f.tx, { codenameId: 'raven', agentId: 'a', actorId: 'user' }), /Gekündigten/)
  await assert.rejects(assignCodenameInTransaction(f.tx, { codenameId: 'raven', agentId: 'missing', actorId: 'user' }), /nicht gefunden/)
  assert.equal(f.history.length, 0)
})

test('release retains the original note, records the releaser and permits immediate reuse', async () => {
  const f = fixture()
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user', note: 'Original' })
  await closeCodenameAssignment(f.tx, 'ghost', 'other', 'MANUAL', 'Abschluss')
  assert.equal(f.history[0].note, 'Original\nFreigabe: Abschluss')
  assert.equal(f.history[0].releasedById, 'other')
  assert.ok(f.history[0].releasedAt)
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'b', actorId: 'user' })
  assert.equal(f.history.length, 2)
  assert.equal(f.names[0].currentAgentId, 'b')
})

test('termination closes the alias in the caller transaction', async () => {
  const f = fixture()
  await assignCodenameInTransaction(f.tx, { codenameId: 'ghost', agentId: 'a', actorId: 'user' })
  await releaseTerminatedCodename(f.tx, 'a', 'hr')
  await releaseTerminatedCodename(f.tx, 'a', 'hr')
  assert.equal(f.names[0].currentAgentId, null)
  assert.equal(f.history[0].releaseReason, 'TERMINATED')
  assert.equal(f.history[0].releasedById, 'hr')
  assert.equal(f.audit.filter(a => a.action === 'CODENAME_RELEASED').length, 1)
})

test('board renders 0, 30, 31 and 91 holders without dropping entries', () => {
  for (const count of [0, 30, 31, 91]) {
    const rows = Array.from({ length: count }, (_, n) => ({ name: `Alias-${n}`, currentAgent: { firstName: 'Sam', lastName: 'Reyes', badgeNumber: `FIB-${n}` } }))
    const pages = codenameBoardPages(rows, 'Agent')
    assert.equal(pages.length, Math.max(1, Math.ceil(count / 30)))
    for (const row of rows) assert.ok(pages.join('\n').includes(`Agent ${row.name}  |`))
    for (const page of pages) assert.ok(page.length < 4000)
  }
})

test('long board rows split by character budget and cannot break code blocks', () => {
  const rows = Array.from({ length: 30 }, (_, n) => ({ name: 'N'.repeat(80) + n, currentAgent: { firstName: 'F'.repeat(191), lastName: 'L'.repeat(191) + '\n```', badgeNumber: '1'.repeat(191) } }))
  const pages = codenameBoardPages(rows, 'P'.repeat(40))
  assert.ok(pages.length > 1)
  for (const page of pages) { assert.ok(page.length < 4000); assert.equal(page.match(/```/g)?.length, 2) }
  assert.equal(pages.join('\n').match(/  \|  /g)?.length, 60)
})

test('input validation rejects coerced booleans, invalid pagination and unsafe names', () => {
  assert.equal(assignCodenameSchema.safeParse({ agentId: 'a', force: 'false' }).success, false)
  assert.equal(releaseCodenameSchema.safeParse({ retire: 'false' }).success, false)
  for (const page of ['0', '-1', '1.5', 'NaN']) assert.equal(codenameQuerySchema.safeParse({ page }).success, false)
  assert.equal(codenameQuerySchema.safeParse({ pageSize: 10000 }).success, false)
  assert.equal(createCodenameSchema.safeParse({ name: 'Ghost\n```' }).success, false)
  assert.equal(createCodenameSchema.safeParse({ name: 'x'.repeat(81) }).success, false)
})

test('seed has 2000–3000 unique valid names and management implies view and agent access', () => {
  const data = createCodenameSchema.array().parse(JSON.parse(readFileSync(new URL('../prisma/data/codenames.json', import.meta.url), 'utf8')))
  assert.ok(data.length >= 2000 && data.length <= 3000)
  assert.equal(new Set(data.map(row => row.name.toLowerCase())).size, data.length)
  assert.ok(normalizePermissions(['codenames:manage']).includes('codenames:view'))
  assert.ok(normalizePermissions(['codenames:manage']).includes('agents:view'))
  assert.equal(normalizePermissions(['codenames:view']).includes('codenames:manage'), false)
})

test('board reconciliation edits existing messages, creates missing pages, and removes excess pages', async () => {
  const calls: string[] = []
  let saved: string[] = []
  const input = {
    ids: ['old'], pages: ['page1', 'page2'],
    patch: async (id: string) => { calls.push(`patch:${id}`) },
    post: async () => { calls.push('post'); return 'new' },
    remove: async (id: string) => { calls.push(`delete:${id}`) },
    save: async (ids: string[]) => { saved = ids },
    isMissing: () => false,
  }
  assert.deepEqual(await reconcileCodenameMessages(input), ['old', 'new'])
  assert.deepEqual(saved, ['old', 'new'])
  assert.deepEqual(calls, ['patch:old', 'post'])
  calls.length = 0
  assert.deepEqual(await reconcileCodenameMessages({ ...input, ids: saved, pages: ['empty roster'] }), ['old'])
  assert.deepEqual(calls, ['patch:old', 'delete:new'])
})

test('board replaces only deleted messages and keeps saved progress after a later failure', async () => {
  const missing = new Error('missing')
  const forbidden = new Error('forbidden')
  let posts = 0
  let saved: string[] = []
  const input = {
    ids: ['missing'], pages: ['page1'],
    patch: async () => { throw missing },
    post: async () => { posts++; return 'replacement' },
    remove: async () => {},
    save: async (ids: string[]) => { saved = ids },
    isMissing: (cause: unknown) => cause === missing,
  }
  assert.deepEqual(await reconcileCodenameMessages(input), ['replacement'])
  await assert.rejects(reconcileCodenameMessages({ ...input, patch: async () => { throw forbidden } }), /forbidden/)
  assert.equal(posts, 1)
  let counter = 0
  await assert.rejects(reconcileCodenameMessages({ ...input, ids: [], pages: ['one', 'two'], post: async () => { if (counter++) throw new Error('timeout'); return 'first-created' } }), /timeout/)
  assert.deepEqual(saved, ['first-created'])
})
