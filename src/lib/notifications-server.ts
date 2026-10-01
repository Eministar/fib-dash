import 'server-only'

import type { CurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import {
  NOTIFICATION_PAGE_SIZE,
  PROBATION_REMINDER_DAYS,
  notificationVisibilityWhere,
  recipientDedupeKey,
  resolveRecipients,
  type NotificationInbox,
  type NotificationKind,
} from '@/lib/notifications'
import type { Permission } from '@/lib/permissions'

interface NotifyBase {
  kind: NotificationKind
  title: string
  body?: string | null
  href?: string | null
  actorId?: string | null
}

type NotifyInput = NotifyBase &
  ({ userIds: readonly (string | null | undefined)[]; dedupeKey?: string } | { permission: Permission; dedupeKey?: string })

/**
 * Legt Benachrichtigungen an. Wirft nie: eine fehlgeschlagene Benachrichtigung
 * darf die eigentliche Aktion (Zuweisung, Beförderung, …) nicht zurückrollen.
 */
export async function notify(input: NotifyInput): Promise<number> {
  const base = {
    kind: input.kind,
    title: input.title.slice(0, 200),
    body: input.body ? input.body.slice(0, 500) : null,
    href: input.href ? input.href.slice(0, 500) : null,
    actorId: input.actorId ?? null,
  }

  try {
    if ('permission' in input) {
      await prisma.notification.create({
        data: { ...base, permission: input.permission, dedupeKey: input.dedupeKey ?? null },
      })
      return 1
    }

    let created = 0
    for (const userId of resolveRecipients(input.userIds, input.actorId)) {
      try {
        await prisma.notification.create({
          data: { ...base, userId, dedupeKey: recipientDedupeKey(input.dedupeKey, userId) },
        })
        created += 1
      } catch (cause) {
        // Bereits benachrichtigt (Dedupe) – kein Fehler.
        if (!isUniqueConstraintError(cause)) throw cause
      }
    }
    return created
  } catch (cause) {
    if (isUniqueConstraintError(cause)) return 0
    console.error('[notifications] Anlegen fehlgeschlagen:', cause)
    return 0
  }
}

/**
 * Dashboard-Konten zu Agents. Primär über die feste Verknüpfung
 * `Agent.userId`, sonst – wie überall im Dashboard – über die Discord-ID.
 */
export async function userIdsForAgents(agentIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(agentIds.filter(Boolean))]
  if (ids.length === 0) return []

  const agents = await prisma.agent.findMany({
    where: { id: { in: ids } },
    select: { userId: true, discordId: true },
  })
  const linked = agents.map((agent) => agent.userId).filter((id): id is string => Boolean(id))
  const discordIds = agents
    .filter((agent) => !agent.userId && agent.discordId)
    .map((agent) => agent.discordId as string)

  if (discordIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { discordId: { in: discordIds } },
      select: { id: true },
    })
    linked.push(...users.map((user) => user.id))
  }

  return [...new Set(linked)]
}

/** Benachrichtigt die Konten der genannten Agents. Wirft nie. */
export async function notifyAgents(agentIds: readonly string[], input: NotifyBase & { dedupeKey?: string }) {
  try {
    const userIds = await userIdsForAgents(agentIds)
    return notify({ ...input, userIds })
  } catch (cause) {
    console.error('[notifications] Empfänger konnten nicht ermittelt werden:', cause)
    return 0
  }
}

export async function getInbox(user: CurrentUser): Promise<NotificationInbox> {
  const where = notificationVisibilityWhere(user.id, user.permissions)
  const unreadWhere = { ...where, receipts: { none: { userId: user.id } } }

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: NOTIFICATION_PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        href: true,
        createdAt: true,
        actor: { select: { displayName: true } },
        receipts: { where: { userId: user.id }, select: { id: true } },
      },
    }),
    prisma.notification.count({ where: unreadWhere }),
  ])

  return {
    unreadCount,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      actorName: row.actor?.displayName ?? null,
      createdAt: row.createdAt.toISOString(),
      read: row.receipts.length > 0,
    })),
  }
}

/**
 * Markiert Benachrichtigungen als gelesen. Es zählen nur solche, die der Nutzer
 * überhaupt sehen darf – fremde IDs werden still ignoriert.
 */
export async function markNotificationsRead(user: CurrentUser, ids: readonly string[] | 'all') {
  const where = {
    ...notificationVisibilityWhere(user.id, user.permissions),
    receipts: { none: { userId: user.id } },
    ...(ids === 'all' ? {} : { id: { in: [...ids] } }),
  }
  const unread = await prisma.notification.findMany({ where, select: { id: true }, take: 500 })
  if (unread.length === 0) return 0

  const result = await prisma.notificationReceipt.createMany({
    data: unread.map((row) => ({ notificationId: row.id, userId: user.id })),
    skipDuplicates: true,
  })
  return result.count
}

const PROBATION_SYNC_INTERVAL_MS = 15 * 60_000
let lastProbationSync = 0

/**
 * Erinnert Agent und Ersteller, wenn eine aktive Probezeit in den nächsten
 * Tagen endet. Gedrosselt je Prozess; der Dedupe-Schlüssel sorgt dafür, dass
 * jede Probezeit pro Empfänger nur einmal gemeldet wird.
 */
export async function syncProbationReminders(options: { force?: boolean } = {}) {
  const now = Date.now()
  if (!options.force && now - lastProbationSync < PROBATION_SYNC_INTERVAL_MS) return 0
  lastProbationSync = now

  try {
    const probations = await prisma.probation.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: { gt: new Date(now), lte: new Date(now + PROBATION_REMINDER_DAYS * 86_400_000) },
      },
      select: {
        id: true,
        endsAt: true,
        createdById: true,
        agentId: true,
        agent: { select: { firstName: true, lastName: true } },
      },
      take: 200,
    })

    let created = 0
    for (const probation of probations) {
      const agentUsers = await userIdsForAgents([probation.agentId])
      created += await notify({
        kind: 'PROBATION_ENDING',
        title: `Probezeit von ${probation.agent.firstName} ${probation.agent.lastName} endet bald`,
        body: `Ende: ${probation.endsAt.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`,
        href: '/probations',
        userIds: [...agentUsers, probation.createdById],
        dedupeKey: `probation-ending:${probation.id}`,
      })
    }
    return created
  } catch (cause) {
    console.error('[notifications] Probezeit-Erinnerungen fehlgeschlagen:', cause)
    return 0
  }
}

interface InvestigationRef {
  id: string
  caseNumber: string
  title: string
}

/**
 * Meldet neu zugewiesene Ermittler und eine neue Fallführung. Wer bereits
 * zugewiesen war, bekommt nichts – nur Änderungen sind eine Nachricht wert.
 */
export async function notifyInvestigationTeam(input: {
  investigation: InvestigationRef
  actorId: string
  addedAssigneeIds?: readonly string[]
  newLeadAgentId?: string | null
}) {
  const { investigation, actorId } = input
  const href = `/investigations/${investigation.id}`
  const subject = `${investigation.caseNumber} – ${investigation.title}`

  if (input.newLeadAgentId) {
    await notifyAgents([input.newLeadAgentId], {
      kind: 'INVESTIGATION_LEAD',
      title: 'Du führst jetzt eine Ermittlung',
      body: subject,
      href,
      actorId,
    })
  }

  const assignees = (input.addedAssigneeIds ?? []).filter((agentId) => agentId !== input.newLeadAgentId)
  if (assignees.length > 0) {
    await notifyAgents(assignees, {
      kind: 'INVESTIGATION_ASSIGNED',
      title: 'Du wurdest einer Ermittlung zugewiesen',
      body: subject,
      href,
      actorId,
    })
  }
}
