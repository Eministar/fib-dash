import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized, notFound } from '@/lib/api-response'
import { sessionDurationMs } from '@/lib/duty-times'
import { PROBATION_ENTRY_RATING_LABELS, PROBATION_STATUS_LABELS, PROBATION_TYPE_LABELS } from '@/lib/probations'
import { sanctionMeasureLabel } from '@/lib/sanction-catalog'
import { sanctionStatusLabel } from '@/lib/sanctions'
import { displayBadgeNumber } from '@/lib/badge-number'
import { formatDateTime } from '@/lib/utils'
import { formatDuration, type TimelineDetail, type TimelineEntry, type TimelineResponse } from '@/lib/agent-timeline'

type Draft = Omit<TimelineEntry, 'occurredAt' | 'details' | 'description'> & {
  /** Bisheriger Typ-Name – externe API-Nutzer lesen `type` weiter. */
  type: string
  occurredAt: Date
  description?: string | null
  details?: (TimelineDetail | null | false | undefined)[]
}

/** Nur befüllte Details übernehmen – leere Felder wären in der Akte Rauschen. */
function detail(label: string, value: unknown): TimelineDetail | null {
  if (value === null || value === undefined || value === '') return null
  return { label, value: String(value) }
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
      recordEntries: { include: { author: { select: { displayName: true } } } },
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

  const drafts: Draft[] = []
  const push = (draft: Draft) => drafts.push(draft)

  push({
    id: `hire-${agent.id}`,
    type: 'hire',
    category: 'status',
    tone: 'positive',
    title: 'Einstellung',
    description: `Eingestellt als ${agent.rank.name}`,
    occurredAt: agent.hireDate,
  })

  for (const log of agent.promotionLogs) {
    const promoted = log.newRank.sortOrder < log.oldRank.sortOrder
    push({
      id: `rank-${log.id}`,
      type: promoted ? 'promotion' : 'demotion',
      category: 'rank',
      tone: promoted ? 'positive' : 'negative',
      title: promoted ? 'Beförderung' : 'Degradierung',
      description: `${log.oldRank.name} → ${log.newRank.name}${log.note ? ` · ${log.note}` : ''}`,
      occurredAt: log.createdAt,
      details: [
        log.oldBadgeNumber !== log.newBadgeNumber && log.newBadgeNumber
          ? detail('Dienstnummer', `${displayBadgeNumber(log.oldBadgeNumber)} → ${displayBadgeNumber(log.newBadgeNumber)}`)
          : null,
        detail('Durchgeführt von', log.performedBy?.displayName ?? 'Gelöschter Benutzer'),
      ],
    })
  }

  for (const sanction of agent.sanctions) {
    push({
      id: `sanction-${sanction.id}`,
      type: 'sanction',
      category: 'sanction',
      tone: 'negative',
      title: `Sanktion · PG ${sanction.penalGrade}`,
      description: sanction.reason,
      occurredAt: sanction.createdAt,
      details: [
        detail('Maßnahme', sanctionMeasureLabel(sanction.level)),
        detail('Status', sanctionStatusLabel(sanction.status)),
        detail('Ausgestellt von', sanction.issuedBy?.displayName ?? 'Gelöschter Benutzer'),
      ],
    })
  }

  for (const note of agent.agentNotes) {
    push({
      id: `note-${note.id}`,
      type: 'note',
      category: 'note',
      tone: 'neutral',
      title: note.title || 'Notiz',
      description: note.content,
      occurredAt: note.createdAt,
      details: [
        detail('Verfasst von', note.author?.displayName ?? 'Gelöschter Benutzer'),
        note.pinned ? detail('Markierung', 'Angepinnt') : null,
      ],
    })
  }

  for (const record of agent.recordEntries) {
    const positive = record.kind === 'POSITIVE'
    push({
      id: `record-${record.id}`,
      type: 'record',
      category: 'record',
      tone: positive ? 'positive' : 'negative',
      title: `${positive ? 'Positiver' : 'Negativer'} Akteneintrag · ${record.title}`,
      description: record.content,
      occurredAt: record.createdAt,
      details: [
        detail('Verfasst von', record.author?.displayName ?? (record.source === 'manual' ? 'Gelöschter Benutzer' : 'System')),
      ],
    })
  }

  for (const termination of agent.terminations) {
    push({
      id: `termination-${termination.id}`,
      type: 'termination',
      category: 'status',
      tone: 'negative',
      title: 'Kündigung',
      description: termination.reason,
      occurredAt: termination.terminatedAt,
      details: [
        detail('Letzter Rang', termination.previousRank),
        detail('Durchgeführt von', termination.terminatedBy?.displayName ?? 'Gelöschter Benutzer'),
      ],
    })
  }

  // Nur abgeschlossene Ausbildungen sind Ereignisse; offene stehen in der Agent-Ansicht.
  for (const training of agent.trainings) {
    if (!training.completed) continue
    push({
      id: `training-${training.id}`,
      type: 'training',
      category: 'training',
      tone: 'positive',
      title: 'Ausbildung abgeschlossen',
      description: training.training.label,
      occurredAt: training.updatedAt,
    })
  }

  for (const absence of agent.absenceNotices) {
    push({
      id: `absence-${absence.id}`,
      type: 'absence',
      category: 'absence',
      tone: 'neutral',
      title: 'Abmeldung',
      description: absence.reason,
      occurredAt: absence.startsAt,
      details: [
        detail('Bis', formatDateTime(absence.endsAt)),
        detail('Eingetragen über', absence.source === 'discord' ? 'Discord' : 'Dashboard'),
      ],
    })
  }

  for (const duty of agent.dutySessions) {
    push({
      id: `duty-${duty.id}`,
      type: 'duty',
      category: 'duty',
      tone: 'neutral',
      title: duty.clockOutAt ? 'Dienst' : 'Im Dienst',
      description: null,
      occurredAt: duty.clockInAt,
      details: [
        duty.clockOutAt ? detail('Ende', formatDateTime(duty.clockOutAt)) : detail('Status', 'Läuft noch'),
        detail('Dauer', formatDuration(sessionDurationMs(duty))),
      ],
    })
  }

  for (const playtime of agent.playtimeSessions) {
    push({
      id: `playtime-${playtime.id}`,
      type: 'playtime',
      category: 'duty',
      tone: 'neutral',
      title: 'Spielzeit',
      description: playtime.playerName,
      occurredAt: playtime.startedAt,
      details: [
        detail('Dauer', formatDuration(sessionDurationMs({ clockInAt: playtime.startedAt, clockOutAt: playtime.endedAt }))),
      ],
    })
  }

  for (const probation of agent.probations) {
    push({
      id: `probation-${probation.id}`,
      type: 'probation',
      category: 'probation',
      tone: probation.status === 'FAILED' ? 'negative' : probation.status === 'PASSED' ? 'positive' : 'neutral',
      title: `${PROBATION_TYPE_LABELS[probation.type]}: ${PROBATION_STATUS_LABELS[probation.status]}`,
      description: probation.resultNote,
      occurredAt: probation.startsAt,
      details: [
        detail('Ende', formatDateTime(probation.endsAt)),
        detail('Entschieden von', probation.decidedBy?.displayName),
      ],
    })

    for (const entry of probation.entries) {
      push({
        id: `probation-entry-${entry.id}`,
        type: 'probation',
        category: 'probation',
        tone: 'neutral',
        title: `Probezeit-Bewertung: ${PROBATION_ENTRY_RATING_LABELS[entry.rating]}`,
        description: entry.comment,
        occurredAt: entry.createdAt,
        details: [
          detail('Probezeit', PROBATION_TYPE_LABELS[probation.type]),
          detail('Bewertet von', entry.createdBy?.displayName ?? 'Gelöschter Benutzer'),
        ],
      })
    }
  }

  for (const event of agent.calendarEvents) {
    push({
      id: `event-${event.id}`,
      type: 'calendar',
      category: 'calendar',
      tone: 'neutral',
      title: event.title,
      description: event.description,
      occurredAt: event.startsAt,
      details: [
        detail('Ort', event.location),
        event.endsAt ? detail('Ende', formatDateTime(event.endsAt)) : null,
      ],
    })
  }

  for (const audit of agent.auditLogs) {
    push({
      id: `audit-${audit.id}`,
      type: 'audit',
      category: 'audit',
      tone: 'neutral',
      title: audit.action,
      description: audit.details,
      occurredAt: audit.createdAt,
      details: [
        detail('Von', audit.user?.displayName ?? 'System'),
        audit.oldValue || audit.newValue ? detail('Änderung', `${audit.oldValue ?? '—'} → ${audit.newValue ?? '—'}`) : null,
      ],
    })
  }

  drafts.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())

  const response: TimelineResponse = {
    agent: {
      id: agent.id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      badgeNumber: agent.badgeNumber,
      rankName: agent.rank.name,
      status: agent.status,
      hireDate: agent.hireDate.toISOString(),
    },
    items: drafts.map((draft) => ({
      id: draft.id,
      // Abwärtskompatibel für API-Nutzer: bisherige Felder `type` und `createdAt`.
      type: draft.type,
      createdAt: draft.occurredAt.toISOString(),
      category: draft.category,
      tone: draft.tone,
      title: draft.title,
      description: draft.description?.trim() || null,
      occurredAt: draft.occurredAt.toISOString(),
      details: (draft.details ?? []).filter((item): item is TimelineDetail => Boolean(item)),
    })),
  }
  return success(response)
}
