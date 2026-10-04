import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAccessInvestigation, investigationVisibilityWhere, type InvestigationAccessShape } from '../src/lib/investigations'
import type { CurrentUser } from '../src/lib/auth'

const user = (overrides: Partial<CurrentUser> = {}): CurrentUser => ({
  id: 'u1', username: 'u1', displayName: 'Nutzer', discordId: '111111111111111111', avatarUrl: null, groups: [], permissions: ['investigations:view'], ...overrides,
})

const member = (agent: { userId?: string | null; discordId?: string | null; status?: string }) =>
  ({ agent: { userId: agent.userId ?? null, discordId: agent.discordId ?? null, status: agent.status ?? 'ACTIVE' } })

const classified = (members: ReturnType<typeof member>[]): InvestigationAccessShape => ({
  classified: true, createdById: 'someone-else', leadAgent: null, assignees: [],
  dossiers: [{ accessGroups: [{ group: { agents: members } }] }],
})

test('a group assigned to a dossier opens its classified cases to members', () => {
  assert.equal(canAccessInvestigation(user(), classified([member({ userId: 'u1' })])), true)
  // Legacy-Verknüpfung über die Discord-ID der Personalakte.
  assert.equal(canAccessInvestigation(user(), classified([member({ discordId: '111111111111111111' })])), true)
})

test('non-members, terminated members and cases without groups stay closed', () => {
  assert.equal(canAccessInvestigation(user(), classified([member({ userId: 'other', discordId: '222222222222222222' })])), false)
  assert.equal(canAccessInvestigation(user(), classified([member({ userId: 'u1', status: 'TERMINATED' })])), false)
  assert.equal(canAccessInvestigation(user(), { classified: true, createdById: null }), false)
  // Ohne Discord-ID darf ein leeres Discord-Feld der Akte nicht passen.
  assert.equal(canAccessInvestigation(user({ discordId: null }), classified([member({ userId: 'x', discordId: null })])), false)
})

test('the list filter adds exactly one dossier-group branch', () => {
  assert.deepEqual(investigationVisibilityWhere(user({ permissions: ['investigations:classified'] })), {})
  const where = investigationVisibilityWhere(user()) as { OR: object[] }
  assert.deepEqual(where.OR.at(-1), { dossiers: { some: { accessGroups: { some: { group: { agents: { some: { agent: {
    status: { not: 'TERMINATED' }, OR: [{ userId: 'u1' }, { discordId: '111111111111111111' }],
  } } } } } } } } })
  const withoutDiscord = investigationVisibilityWhere(user({ discordId: null })) as { OR: object[] }
  assert.deepEqual(withoutDiscord.OR.at(-1), { dossiers: { some: { accessGroups: { some: { group: { agents: { some: { agent: {
    status: { not: 'TERMINATED' }, OR: [{ userId: 'u1' }],
  } } } } } } } } })
})
