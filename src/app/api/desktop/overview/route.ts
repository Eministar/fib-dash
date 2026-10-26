import { success } from '@/lib/api-response'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { agentTaskModules, missingAgentTrainings, type AgentOpenTask } from '@/lib/agents/agent-open-tasks'
import { getDutyTimesSnapshot } from '@/lib/duty/duty-times'
import { findAgentForUser } from '@/lib/duty/manual-duty'
import { routeError } from '@/lib/investigations/investigations-server'
import { TASK_MODULES, type TaskModuleKey } from '@/lib/units/module-permissions'

export const dynamic = 'force-dynamic'

/** So weit voraus zeigt die Übersicht Termine. */
const EVENT_DAYS = 14
const EVENT_LIMIT = 5
const NOTE_LIMIT = 5

/**
 * Persönliche Übersicht der Desktop-Startseite: nur Daten des angemeldeten Kontos –
 * Dienstzeit dieser Woche, offene Aufgaben, laufende Probezeit, nächste Termine und
 * eigene Schnellnotizen. Ein Aufruf statt fünf, ohne Rechte wie `agents:view`.
 */
export async function GET() {
  try {
    const user = await requireAuth()
    const own = await findAgentForUser(user)
    const now = new Date()

    // Termine: allgemeine mit Kalenderrecht, Modul-Termine mit Modulrecht – und immer
    // die, die den eigenen Agent betreffen (z. B. die eigene Prüfung).
    const modules = TASK_MODULES.filter((module: TaskModuleKey) => hasPermission(user, agentTaskModules[module].permission))
    const eventVisibility = [
      ...(hasPermission(user, 'calendar:view') ? [{ module: null }] : []),
      ...(modules.length ? [{ module: { in: [...modules] } }] : []),
      ...(own ? [{ agentId: own.id }] : []),
    ]

    const [agent, snapshot, probation, events, notes, trainings, tasks, contracts] = await Promise.all([
      own
        ? prisma.agent.findUnique({
            where: { id: own.id },
            select: {
              id: true, firstName: true, lastName: true, badgeNumber: true, status: true,
              rank: { select: { name: true, color: true, sortOrder: true } },
              trainings: { select: { trainingId: true, completed: true } },
            },
          })
        : null,
      own ? getDutyTimesSnapshot(now, { sync: false }) : null,
      own
        ? prisma.probation.findFirst({
            where: { agentId: own.id, status: 'ACTIVE' },
            select: { type: true, startsAt: true, endsAt: true },
            orderBy: { endsAt: 'asc' },
          })
        : null,
      eventVisibility.length
        ? prisma.calendarEvent.findMany({
            where: {
              OR: eventVisibility,
              startsAt: { lte: new Date(now.getTime() + EVENT_DAYS * 86_400_000) },
              // Laufende Termine (begonnen, noch nicht vorbei) zählen mit.
              AND: [{ OR: [{ startsAt: { gte: now } }, { endsAt: { gte: now } }] }],
            },
            select: { id: true, title: true, type: true, startsAt: true, endsAt: true, location: true },
            orderBy: { startsAt: 'asc' },
            take: EVENT_LIMIT,
          })
        : [],
      prisma.note.findMany({
        where: { authorId: user.id, private: true },
        select: { id: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: NOTE_LIMIT,
      }),
      own
        ? prisma.training.findMany({ select: { id: true, label: true, sortOrder: true, minRank: { select: { sortOrder: true } } }, orderBy: { sortOrder: 'asc' } })
        : [],
      own
        ? prisma.task.findMany({
            where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, assignments: { some: { agentId: own.id } }, list: { archived: false } },
            select: { id: true, title: true, status: true, dueDate: true, list: { select: { title: true, module: true } } },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          })
        : [],
      own
        ? prisma.contract.findMany({ where: { agentId: own.id, status: 'SENT' }, select: { id: true, title: true }, orderBy: { createdAt: 'asc' } })
        : [],
    ])

    const row = agent && snapshot?.rows.find((candidate) => candidate.id === agent.id)
    const openTasks: AgentOpenTask[] = [
      // Eigene Aufgaben sind immer sichtbar – sie sind einem selbst zugewiesen.
      ...tasks
        .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
        .map((task) => ({
          id: task.id,
          title: task.title,
          detail: `${agentTaskModules[task.list.module].label} · ${task.list.title}`,
          kind: 'task' as const,
          dueDate: task.dueDate?.toISOString() ?? null,
          canComplete: false,
          inProgress: task.status === 'IN_PROGRESS',
          overdue: !!task.dueDate && task.dueDate.getTime() < now.getTime(),
        })),
      ...contracts.map((contract) => ({ id: contract.id, title: contract.title, detail: 'Unterschrift ausstehend', kind: 'contract' as const, dueDate: null, canComplete: false })),
      ...(agent && agent.rank ? missingAgentTrainings({ ...agent, rank: agent.rank }, trainings) : []),
    ]

    return success({
      agent: agent
        ? {
            name: `${agent.firstName} ${agent.lastName}`,
            badge: displayBadgeNumber(agent.badgeNumber),
            rank: agent.rank ? { name: agent.rank.name, color: agent.rank.color } : null,
          }
        : null,
      duty: row
        ? {
            onDuty: !!row.activeSession,
            since: row.activeSession?.clockInAt ?? null,
            weekMs: row.weekDurationMs,
            sessionCount: row.sessionCount,
            weekStart: snapshot!.weekStart,
          }
        : null,
      probation: probation
        ? { type: probation.type, startsAt: probation.startsAt, endsAt: probation.endsAt }
        : null,
      tasks: openTasks,
      events,
      notes,
    })
  } catch (cause) {
    return routeError(cause)
  }
}
