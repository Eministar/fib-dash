import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { getDutyTimesSnapshot } from '@/lib/duty-times'
import { getActiveAbsenceNotices, runAgentStatusAutomation } from '@/lib/absence-status'
import { eligibleTrainingsForRank, isTrainingAvailableForRank } from '@/lib/agent-trainings'
import { runAuditLogCleanup } from '@/lib/audit-log-retention'

const RECENT_WINDOW_DAYS = 30
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktiv',
  AWAY: 'Abgemeldet',
  INACTIVE: 'Inaktiv',
  TERMINATED: 'Gekündigt',
}

export async function GET() {
  let user
  try {
    user = await requirePermission('dashboard:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const recentSince = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  // Status-Automation NICHT abwarten: sie schreibt sequenziell pro Agent und ist
  // ohnehin auf 60s gedrosselt. Blockieren würde den (häufig gepollten) Stats-Request
  // unnötig verlangsamen. Ergebnis basiert auf dem zuletzt gespeicherten Stand.
  void runAgentStatusAutomation().catch((err) => {
    console.error('[Stats] Status-Automation fehlgeschlagen:', err)
  })
  void runAuditLogCleanup().catch((err) => {
    console.error('[Stats] Audit-Protokoll-Bereinigung fehlgeschlagen:', err)
  })

  const canViewLogs = hasPermission(user, 'logs:view')
  const canViewNotes = hasPermission(user, 'notes:view')
  const canViewDutyTimes = hasPermission(user, 'duty-times:view')

  const [
    agents,
    ranks,
    trainings,
    totalPromotions,
    recentPromotions,
    recentTerminations,
    draftRankChangeLists,
    dutyTimes,
    activeAbsences,
    overdueSanctions,
    probationsEndingSoon,
    upcomingEvents,
  ] = await Promise.all([
    prisma.agent.findMany({
      select: {
        id: true,
        badgeNumber: true,
        firstName: true,
        lastName: true,
        rankId: true,
        status: true,
        hireDate: true,
        lastOnline: true,
        updatedAt: true,
        rank: { select: { name: true, color: true, sortOrder: true } },
        trainings: { select: { trainingId: true, completed: true } },
      },
    }),
    prisma.rank.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.training.findMany({
      include: { minRank: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.promotionLog.count(),
    prisma.promotionLog.count({
      where: { createdAt: { gte: recentSince } },
    }),
    prisma.termination.count({
      where: { terminatedAt: { gte: recentSince } },
    }),
    prisma.rankChangeList.count({ where: { status: 'DRAFT' } }),
    canViewDutyTimes ? getDutyTimesSnapshot(new Date(), { sync: false }) : Promise.resolve(null),
    getActiveAbsenceNotices(),
    prisma.sanction.count({
      where: { status: 'OPEN', dueAt: { lt: new Date() } },
    }),
    prisma.probation.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, rank: true } },
      },
      orderBy: { endsAt: 'asc' },
      take: 5,
    }),
    prisma.calendarEvent.findMany({
      where: {
        startsAt: {
          gte: new Date(),
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, rank: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),
  ])

  const [recentActivity, pinnedNotes] = await Promise.all([
    canViewLogs
      ? prisma.auditLog.findMany({
        include: {
          user: { select: { displayName: true } },
          agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      })
      : Promise.resolve([]),
    canViewNotes
      ? prisma.note.findMany({
        where: { pinned: true },
        include: {
          author: { select: { displayName: true } },
          agent: { select: { id: true, firstName: true, lastName: true, badgeNumber: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      })
      : Promise.resolve([]),
  ])

  const totalAgents = agents.length
  const activeAgents = agents.filter((agent) => agent.status === 'ACTIVE').length
  const awayAgents = agents.filter((agent) => agent.status === 'AWAY').length
  const inactiveAgents = agents.filter((agent) => agent.status === 'INACTIVE').length
  const terminatedAgents = agents.filter((agent) => agent.status === 'TERMINATED').length
  const currentAgents = totalAgents - terminatedAgents
  const currentAgentList = agents.filter((agent) => agent.status !== 'TERMINATED')

  const distribution = ranks.map((rank) => ({
    rank: rank.name,
    color: rank.color,
    count: currentAgentList.filter((agent) => agent.rankId === rank.id).length,
  }))

  const statusDistribution = Object.entries(STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    count: agents.filter((agent) => agent.status === status).length,
  }))

  const eligibleTrainingsByAgentId = new Map(
    currentAgentList.map((agent) => [agent.id, eligibleTrainingsForRank(trainings, agent.rank)]),
  )
  const totalTrainingAssignments = currentAgentList.reduce((total, agent) => (
    total + (eligibleTrainingsByAgentId.get(agent.id)?.length ?? 0)
  ), 0)
  const completedTrainingAssignments = currentAgentList.reduce((total, agent) => (
    total + agent.trainings.filter((training) => (
      training.completed &&
      (eligibleTrainingsByAgentId.get(agent.id) ?? []).some((eligible) => eligible.id === training.trainingId)
    )).length
  ), 0)
  const trainingCompletionRate = totalTrainingAssignments > 0
    ? Math.round((completedTrainingAssignments / totalTrainingAssignments) * 100)
    : 0

  const trainingBreakdown = trainings.map((training) => {
    const completed = currentAgentList.filter((agent) => (
      isTrainingAvailableForRank(training, agent.rank) &&
      agent.trainings.some((agentTraining) => (
        agentTraining.trainingId === training.id && agentTraining.completed
      ))
    )).length
    const total = currentAgentList.filter((agent) => isTrainingAvailableForRank(training, agent.rank)).length

    return {
      id: training.id,
      label: training.label,
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    }
  })

  const attentionAgents = agents
    .filter((agent) => agent.status === 'AWAY' || agent.status === 'INACTIVE')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 6)
    .map((agent) => ({
      id: agent.id,
      badgeNumber: agent.badgeNumber,
      firstName: agent.firstName,
      lastName: agent.lastName,
      status: agent.status,
      lastOnline: agent.lastOnline,
      updatedAt: agent.updatedAt,
      rank: agent.rank,
    }))

  const recentHires = [...currentAgentList]
    .sort((a, b) => b.hireDate.getTime() - a.hireDate.getTime())
    .slice(0, 5)
    .map((agent) => ({
      id: agent.id,
      badgeNumber: agent.badgeNumber,
      firstName: agent.firstName,
      lastName: agent.lastName,
      hireDate: agent.hireDate,
      rank: agent.rank,
    }))

  const readinessRate = currentAgents > 0 ? Math.round((activeAgents / currentAgents) * 100) : 0
  const agentsMissingTraining = currentAgentList.filter((agent) => (
    (eligibleTrainingsByAgentId.get(agent.id) ?? []).some((training) => (
      !agent.trainings.some((item) => item.trainingId === training.id && item.completed)
    ))
  )).length
  const notifications = [
    ...(overdueSanctions > 0 ? [{
      id: 'overdue-sanctions',
      severity: 'error',
      title: `${overdueSanctions} Sanktion${overdueSanctions === 1 ? '' : 'en'} überfällig`,
      description: 'Offene Sanktionen mit überschrittener Frist prüfen.',
      href: '/agents',
    }] : []),
    ...(agentsMissingTraining > 0 ? [{
      id: 'missing-trainings',
      severity: 'warning',
      title: `${agentsMissingTraining} Agent ohne vollständige Ausbildung`,
      description: 'Mindestens eine Ausbildung ist noch offen.',
      href: '/agents',
    }] : []),
    ...(probationsEndingSoon.length > 0 ? [{
      id: 'probations-ending',
      severity: 'warning',
      title: `${probationsEndingSoon.length} Probezeit${probationsEndingSoon.length === 1 ? '' : 'en'} endet diese Woche`,
      description: probationsEndingSoon.map((item) => `${item.agent.firstName} ${item.agent.lastName}`).join(', '),
      href: '/hr?tab=probations',
    }] : []),
    ...(upcomingEvents.length > 0 ? [{
      id: 'upcoming-events',
      severity: 'info',
      title: `${upcomingEvents.length} Termin${upcomingEvents.length === 1 ? '' : 'e'} in den nächsten 7 Tagen`,
      description: upcomingEvents[0]?.title ?? 'Kalender prüfen.',
      href: '/calendar',
    }] : []),
  ]

  return success({
    totalAgents,
    activeAgents,
    awayAgents,
    inactiveAgents,
    terminatedAgents,
    currentAgents,
    totalPromotions,
    recentPromotions,
    recentTerminations,
    readinessRate,
    totalTrainingAssignments,
    completedTrainingAssignments,
    trainingCompletionRate,
    draftRankChangeLists,
    dutyTimes: dutyTimes ? {
      activeCount: dutyTimes.activeCount,
      totalActiveDurationMs: dutyTimes.totalActiveDurationMs,
      totalWeekDurationMs: dutyTimes.totalWeekDurationMs,
      activeRows: dutyTimes.activeRows.slice(0, 5),
    } : null,
    activeAbsences: activeAbsences.slice(0, 8).map((absence) => ({
      id: absence.id,
      startsAt: absence.startsAt,
      endsAt: absence.endsAt,
      reason: absence.reason,
      source: absence.source,
      agent: absence.agent,
    })),
    notifications,
    probationsEndingSoon: probationsEndingSoon.map((probation) => ({
      id: probation.id,
      endsAt: probation.endsAt,
      agent: probation.agent,
    })),
    upcomingEvents: upcomingEvents.map((event) => ({
      id: event.id,
      title: event.title,
      type: event.type,
      startsAt: event.startsAt,
      agent: event.agent,
    })),
    recentWindowDays: RECENT_WINDOW_DAYS,
    rankDistribution: distribution,
    statusDistribution,
    trainingBreakdown,
    attentionAgents,
    recentHires,
    recentActivity,
    pinnedNotes,
  })
}
