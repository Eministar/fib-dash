import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { sessionDurationMs } from '@/lib/duty-times'
import { PROBATION_ENTRY_RATING_LABELS, PROBATION_STATUS_LABELS, PROBATION_TYPE_LABELS } from '@/lib/probations'
import { sanctionMeasureLabel } from '@/lib/sanction-catalog'

type TimelineItem = {
  id: string
  type: string
  title: string
  description?: string | null
  createdAt: Date
  meta?: Record<string, unknown>
}

function push(items: TimelineItem[], item: TimelineItem) {
  items.push(item)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('agents:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const { id } = await params
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      rank: true,
      promotionLogs: {
        include: { oldRank: true, newRank: true, performedBy: { select: { displayName: true } } },
      },
      sanctions: { include: { issuedBy: { select: { displayName: true } } } },
      agentNotes: { include: { author: { select: { displayName: true } } } },
      terminations: { include: { terminatedBy: { select: { displayName: true } } } },
      trainings: { include: { training: true } },
      absenceNotices: true,
      dutySessions: true,
      playtimeSessions: true,
      probations: {
        include: {
          createdBy: { select: { displayName: true } },
          decidedBy: { select: { displayName: true } },
          entries: {
            include: { createdBy: { select: { displayName: true } } },
          },
        },
      },
      calendarEvents: true,
      auditLogs: { include: { user: { select: { displayName: true } } } },
    },
  })
  if (!agent) return notFound('Agent')

  const items: TimelineItem[] = []
  push(items, {
    id: `hire-${agent.id}`,
    type: 'hire',
    title: 'Einstellung',
    description: `${agent.firstName} ${agent.lastName} als ${agent.rank.name}`,
    createdAt: agent.hireDate,
  })

  for (const log of agent.promotionLogs) {
    push(items, {
      id: `rank-${log.id}`,
      type: log.newRank.sortOrder < log.oldRank.sortOrder ? 'promotion' : 'demotion',
      title: log.newRank.sortOrder < log.oldRank.sortOrder ? 'Beförderung' : 'Degradierung',
      description: `${log.oldRank.name} → ${log.newRank.name}${log.note ? ` · ${log.note}` : ''}`,
      createdAt: log.createdAt,
      meta: { actor: log.performedBy?.displayName ?? 'Gelöscht', oldBadgeNumber: log.oldBadgeNumber, newBadgeNumber: log.newBadgeNumber },
    })
  }

  for (const sanction of agent.sanctions) {
    push(items, {
      id: `sanction-${sanction.id}`,
      type: 'sanction',
      title: `Sanktion · Penal Grade ${sanction.penalGrade}`,
      description: sanction.reason,
      createdAt: sanction.createdAt,
      meta: { status: sanction.status, measure: sanctionMeasureLabel(sanction.level), actor: sanction.issuedBy?.displayName ?? 'Gelöscht' },
    })
  }

  for (const note of agent.agentNotes) {
    push(items, {
      id: `note-${note.id}`,
      type: 'note',
      title: note.title || 'Notiz',
      description: note.content,
      createdAt: note.createdAt,
      meta: { author: note.author?.displayName ?? 'Gelöscht', pinned: note.pinned },
    })
  }

  for (const termination of agent.terminations) {
    push(items, {
      id: `termination-${termination.id}`,
      type: 'termination',
      title: 'Kündigung',
      description: termination.reason,
      createdAt: termination.terminatedAt,
      meta: { actor: termination.terminatedBy?.displayName ?? 'Gelöscht' },
    })
  }

  for (const training of agent.trainings) {
    push(items, {
      id: `training-${training.id}`,
      type: 'training',
      title: training.completed ? 'Ausbildung abgeschlossen' : 'Ausbildung offen',
      description: training.training.label,
      createdAt: training.updatedAt,
      meta: { completed: training.completed },
    })
  }

  for (const absence of agent.absenceNotices) {
    push(items, {
      id: `absence-${absence.id}`,
      type: 'absence',
      title: 'Abmeldung',
      description: absence.reason,
      createdAt: absence.startsAt,
      meta: { endsAt: absence.endsAt, source: absence.source },
    })
  }

  for (const duty of agent.dutySessions) {
    push(items, {
      id: `duty-${duty.id}`,
      type: 'duty',
      title: duty.clockOutAt ? 'Dienstzeit beendet' : 'Dienstzeit gestartet',
      description: duty.clockOutAt ? undefined : 'Aktive Dienstzeit',
      createdAt: duty.clockInAt,
      meta: { clockOutAt: duty.clockOutAt, durationMs: sessionDurationMs(duty) },
    })
  }

  for (const playtime of agent.playtimeSessions) {
    push(items, {
      id: `playtime-${playtime.id}`,
      type: 'playtime',
      title: 'Spielzeit',
      description: playtime.playerName,
      createdAt: playtime.startedAt,
      meta: { endedAt: playtime.endedAt, durationMs: sessionDurationMs({ clockInAt: playtime.startedAt, clockOutAt: playtime.endedAt }) },
    })
  }

  for (const probation of agent.probations) {
    push(items, {
      id: `probation-${probation.id}`,
      type: 'probation',
      title: `${PROBATION_TYPE_LABELS[probation.type]}: ${PROBATION_STATUS_LABELS[probation.status]}`,
      description: probation.resultNote,
      createdAt: probation.startsAt,
      meta: { endsAt: probation.endsAt, decidedBy: probation.decidedBy?.displayName ?? null },
    })

    for (const entry of probation.entries) {
      push(items, {
        id: `probation-entry-${entry.id}`,
        type: 'probation',
        title: `Probezeit-Eintrag: ${PROBATION_ENTRY_RATING_LABELS[entry.rating]}`,
        description: entry.comment,
        createdAt: entry.createdAt,
        meta: {
          probationType: PROBATION_TYPE_LABELS[probation.type],
          author: entry.createdBy?.displayName ?? 'Gelöscht',
        },
      })
    }
  }

  for (const event of agent.calendarEvents) {
    push(items, {
      id: `event-${event.id}`,
      type: 'calendar',
      title: event.title,
      description: event.description,
      createdAt: event.startsAt,
      meta: { eventType: event.type, location: event.location, endsAt: event.endsAt },
    })
  }

  for (const audit of agent.auditLogs) {
    push(items, {
      id: `audit-${audit.id}`,
      type: 'audit',
      title: audit.action,
      description: audit.details,
      createdAt: audit.createdAt,
      meta: { actor: audit.user?.displayName ?? 'Gelöscht', oldValue: audit.oldValue, newValue: audit.newValue },
    })
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return success({ agent: { id: agent.id, firstName: agent.firstName, lastName: agent.lastName, badgeNumber: agent.badgeNumber }, items })
}
