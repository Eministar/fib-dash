// Nur Typen aus Prisma: die Datei wird auch von der Glocke im Client genutzt.
import type { Prisma } from '@/generated/prisma'

export const NOTIFICATION_KINDS = [
  'INVESTIGATION_ASSIGNED',
  'INVESTIGATION_LEAD',
  'RANK_CHANGED',
  'RANK_VOTE_OPEN',
  'PROBATION_ENDING',
  'EVIDENCE_TRANSFERRED',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  INVESTIGATION_ASSIGNED: 'Ermittlung',
  INVESTIGATION_LEAD: 'Fallführung',
  RANK_CHANGED: 'Rangänderung',
  RANK_VOTE_OPEN: 'Abstimmung',
  PROBATION_ENDING: 'Probezeit',
  EVIDENCE_TRANSFERRED: 'Asservat',
}

/** Ältere Benachrichtigungen erscheinen nicht mehr in der Inbox. */
export const NOTIFICATION_RETENTION_DAYS = 30
export const NOTIFICATION_PAGE_SIZE = 30
/** Probezeit-Erinnerung: so viele Tage vor dem Ende. */
export const PROBATION_REMINDER_DAYS = 3

export interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string | null
  href: string | null
  actorName: string | null
  createdAt: string
  read: boolean
}

export interface NotificationInbox {
  items: NotificationItem[]
  unreadCount: number
}

/**
 * Was ein Nutzer sieht: persönliche Benachrichtigungen und Broadcasts an ein
 * Recht, das er hat – nie die Folgen seiner eigenen Aktionen und nichts, was
 * älter als die Aufbewahrungsfrist ist.
 */
export function notificationVisibilityWhere(
  userId: string,
  permissions: readonly string[],
  now = new Date(),
): Prisma.NotificationWhereInput {
  const since = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000)
  const audience: Prisma.NotificationWhereInput[] = [{ userId }]
  if (permissions.length > 0) audience.push({ userId: null, permission: { in: [...permissions] } })

  return {
    createdAt: { gte: since },
    OR: audience,
    NOT: { actorId: userId },
  }
}

/** Liegt das Ende einer Probezeit im Erinnerungsfenster (noch nicht vorbei)? */
export function isProbationReminderDue(endsAt: Date, now = new Date()) {
  const remaining = endsAt.getTime() - now.getTime()
  return remaining > 0 && remaining <= PROBATION_REMINDER_DAYS * 86_400_000
}

/** Dedupe-Schlüssel je Empfänger, damit derselbe Anlass pro Person einmal zählt. */
export function recipientDedupeKey(dedupeKey: string | null | undefined, userId: string) {
  return dedupeKey ? `${dedupeKey}:${userId}`.slice(0, 191) : null
}

/** Empfänger ohne Duplikate, ohne Leerwerte und ohne den Auslöser selbst. */
export function resolveRecipients(userIds: readonly (string | null | undefined)[], actorId?: string | null) {
  return [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId))]
}
