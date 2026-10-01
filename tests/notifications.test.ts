import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  NOTIFICATION_RETENTION_DAYS,
  isProbationReminderDue,
  notificationVisibilityWhere,
  recipientDedupeKey,
  resolveRecipients,
} from '../src/lib/notifications'

const now = new Date('2026-10-01T12:00:00Z')

test('Inbox zeigt persönliche und Rechte-Broadcasts, nie eigene Aktionen', () => {
  const where = notificationVisibilityWhere('u1', ['rank-changes:view'], now)
  assert.deepEqual(where.OR, [{ userId: 'u1' }, { userId: null, permission: { in: ['rank-changes:view'] } }])
  assert.deepEqual(where.NOT, { actorId: 'u1' })
  const since = (where.createdAt as { gte: Date }).gte
  assert.equal(now.getTime() - since.getTime(), NOTIFICATION_RETENTION_DAYS * 86_400_000)
})

test('ohne Rechte gibt es keine Broadcast-Bedingung', () => {
  const where = notificationVisibilityWhere('u1', [], now)
  assert.deepEqual(where.OR, [{ userId: 'u1' }])
})

test('Probezeit-Erinnerung nur im 3-Tage-Fenster vor dem Ende', () => {
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000)
  assert.equal(isProbationReminderDue(inDays(2), now), true)
  assert.equal(isProbationReminderDue(inDays(3), now), true)
  assert.equal(isProbationReminderDue(inDays(3.5), now), false)
  assert.equal(isProbationReminderDue(inDays(-1), now), false)
})

test('Empfänger: ohne Duplikate, Leerwerte und Auslöser', () => {
  assert.deepEqual(resolveRecipients(['a', 'b', 'a', null, undefined, 'actor'], 'actor'), ['a', 'b'])
})

test('Dedupe-Schlüssel ist je Empfänger eindeutig und begrenzt', () => {
  assert.equal(recipientDedupeKey('probation-ending:p1', 'u1'), 'probation-ending:p1:u1')
  assert.equal(recipientDedupeKey(undefined, 'u1'), null)
  assert.equal(recipientDedupeKey('x'.repeat(300), 'u1')!.length, 191)
})
