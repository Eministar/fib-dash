import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { storedDiscordAvatarUrl } from '@/lib/discord-auth'
import {
  createStatisticsBuckets,
  isInCurrentPeriod,
  isInPreviousPeriod,
  isStatisticsRange,
  resolveStatisticsPeriod,
  type StatisticsMetric,
  type StatisticsPayload,
  type StatisticsSeriesPoint,
  type StatisticsStaffRow,
} from '@/lib/statistics'

const actorSelect = {
  id: true,
  displayName: true,
  discordId: true,
  discordAvatar: true,
  discordDiscriminator: true,
} as const

type Actor = {
  id: string
  displayName: string
  discordId: string | null
  discordAvatar: string | null
  discordDiscriminator: string | null
}

type StaffMetric = Exclude<keyof StatisticsStaffRow, 'id' | 'displayName' | 'avatarUrl' | 'total'>

const APPLICATION_LABELS: Record<string, string> = {
  SUBMITTED: 'Eingereicht',
  IN_REVIEW: 'In Prüfung',
  HR_INTERVIEW: 'HR-Gespräch',
  ACCEPTED: 'Angenommen',
  REJECTED: 'Abgelehnt',
}

function metric<T>(rows: T[], dateOf: (row: T) => Date, period: ReturnType<typeof resolveStatisticsPeriod>): StatisticsMetric {
  return {
    current: rows.filter((row) => isInCurrentPeriod(dateOf(row), period)).length,
    previous: rows.filter((row) => isInPreviousPeriod(dateOf(row), period)).length,
  }
}

function countTrainingCompletions(value: string | null) {
  return value?.match(/→ abgeschlossen/g)?.length ?? 0
}

function actorAvatar(actor: Actor | null) {
  return actor ? storedDiscordAvatarUrl(actor) : null
}

function actorName(actor: Actor | null) {
  return actor?.displayName ?? 'System / gelöschter Nutzer'
}

function agentName(agent: { firstName: string; lastName: string } | null | undefined, fallback = 'Unbekannter Agent') {
  return agent ? `${agent.firstName} ${agent.lastName}` : fallback
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('dashboard:view')

    const requestedRange = req.nextUrl.searchParams.get('range')
    const range = isStatisticsRange(requestedRange) ? requestedRange : 'week'
    const now = new Date()
    const period = resolveStatisticsPeriod(range, now)
    const eventWhere = { gte: period.previousStart, lt: period.end }

    const [
      auditEvents,
      rankChanges,
      terminations,
      sanctions,
      applications,
      probations,
      newTrainingTypes,
      agentStatusGroups,
      rankGroups,
      ranks,
      trainingGroups,
      trainingDefinitions,
      agentsWithOpenTrainings,
      currentAgentIdentities,
      dashboardUsers,
    ] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          action: { in: ['AGENT_CREATED', 'TRAININGS_UPDATED'] },
          createdAt: eventWhere,
        },
        select: {
          id: true,
          action: true,
          newValue: true,
          createdAt: true,
          user: { select: actorSelect },
          agent: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.promotionLog.findMany({
        where: { createdAt: eventWhere },
        select: {
          id: true,
          createdAt: true,
          performedBy: { select: actorSelect },
          agent: { select: { firstName: true, lastName: true } },
          oldRank: { select: { name: true, sortOrder: true } },
          newRank: { select: { name: true, sortOrder: true } },
        },
      }),
      prisma.termination.findMany({
        where: { terminatedAt: eventWhere },
        select: {
          id: true,
          terminatedAt: true,
          previousFirstName: true,
          previousLastName: true,
          terminatedBy: { select: actorSelect },
          agent: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.sanction.findMany({
        where: { createdAt: eventWhere },
        select: { id: true, createdAt: true, issuedBy: { select: actorSelect } },
      }),
      prisma.jobApplication.findMany({
        where: { submittedAt: eventWhere },
        select: { id: true, submittedAt: true, status: true },
      }),
      prisma.probation.findMany({
        where: { createdAt: eventWhere },
        select: { id: true, createdAt: true },
      }),
      prisma.training.findMany({
        where: { createdAt: eventWhere },
        select: { id: true, createdAt: true },
      }),
      prisma.agent.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.agent.groupBy({
        by: ['rankId'],
        where: { status: { not: 'TERMINATED' } },
        _count: { _all: true },
      }),
      prisma.rank.findMany({
        select: { id: true, name: true, color: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.agentTraining.groupBy({
        by: ['trainingId', 'completed'],
        where: { agent: { status: { not: 'TERMINATED' } } },
        _count: { _all: true },
      }),
      prisma.training.findMany({
        select: { id: true, label: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.agentTraining.groupBy({
        by: ['agentId'],
        where: { completed: false, agent: { status: { not: 'TERMINATED' } } },
      }),
      prisma.agent.findMany({
        where: { status: { not: 'TERMINATED' }, discordId: { not: null } },
        select: { discordId: true },
      }),
      prisma.user.findMany({
        where: { discordId: { not: null } },
        select: actorSelect,
      }),
    ])

    const hires = auditEvents.filter((event) => event.action === 'AGENT_CREATED')
    const trainingEvents = auditEvents.filter((event) => event.action === 'TRAININGS_UPDATED')
    const trainingMetric = (current: boolean) => trainingEvents.reduce((total, event) => {
      const inPeriod = current ? isInCurrentPeriod(event.createdAt, period) : isInPreviousPeriod(event.createdAt, period)
      return total + (inPeriod ? countTrainingCompletions(event.newValue) : 0)
    }, 0)
    const promotions = rankChanges.filter((event) => event.newRank.sortOrder < event.oldRank.sortOrder)
    const demotions = rankChanges.filter((event) => event.newRank.sortOrder > event.oldRank.sortOrder)

    const overview = {
      hires: metric(hires, (event) => event.createdAt, period),
      trainingCompletions: { current: trainingMetric(true), previous: trainingMetric(false) },
      promotions: metric(promotions, (event) => event.createdAt, period),
      demotions: metric(demotions, (event) => event.createdAt, period),
      terminations: metric(terminations, (event) => event.terminatedAt, period),
      sanctions: metric(sanctions, (event) => event.createdAt, period),
    }

    const bucketWindows = createStatisticsBuckets(period)
    const series: StatisticsSeriesPoint[] = bucketWindows.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      shortLabel: bucket.shortLabel,
      hires: 0,
      trainingCompletions: 0,
      promotions: 0,
      demotions: 0,
      terminations: 0,
    }))
    const addSeriesValue = (date: Date, field: keyof Omit<StatisticsSeriesPoint, 'key' | 'label' | 'shortLabel'>, amount = 1) => {
      const index = bucketWindows.findIndex((bucket) => date >= bucket.start && date < bucket.end)
      if (index >= 0) series[index][field] += amount
    }
    hires.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => addSeriesValue(event.createdAt, 'hires'))
    trainingEvents.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => (
      addSeriesValue(event.createdAt, 'trainingCompletions', countTrainingCompletions(event.newValue))
    ))
    promotions.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => addSeriesValue(event.createdAt, 'promotions'))
    demotions.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => addSeriesValue(event.createdAt, 'demotions'))
    terminations.filter((event) => isInCurrentPeriod(event.terminatedAt, period)).forEach((event) => addSeriesValue(event.terminatedAt, 'terminations'))

    const staffMap = new Map<string, StatisticsStaffRow>()
    const currentAgentDiscordIds = new Set(currentAgentIdentities.flatMap((agent) => agent.discordId ? [agent.discordId] : []))
    for (const dashboardUser of dashboardUsers) {
      if (!dashboardUser.discordId || !currentAgentDiscordIds.has(dashboardUser.discordId)) continue
      staffMap.set(dashboardUser.id, {
        id: dashboardUser.id,
        displayName: dashboardUser.displayName,
        avatarUrl: actorAvatar(dashboardUser),
        hires: 0,
        trainingCompletions: 0,
        promotions: 0,
        demotions: 0,
        terminations: 0,
        sanctions: 0,
        total: 0,
      })
    }
    const credit = (actor: Actor | null, field: StaffMetric, amount = 1) => {
      if (amount <= 0) return
      const id = actor?.id ?? '__system__'
      const row = staffMap.get(id) ?? {
        id,
        displayName: actorName(actor),
        avatarUrl: actorAvatar(actor),
        hires: 0,
        trainingCompletions: 0,
        promotions: 0,
        demotions: 0,
        terminations: 0,
        sanctions: 0,
        total: 0,
      }
      row[field] += amount
      row.total += amount
      staffMap.set(id, row)
    }
    hires.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => credit(event.user, 'hires'))
    trainingEvents.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => (
      credit(event.user, 'trainingCompletions', countTrainingCompletions(event.newValue))
    ))
    promotions.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => credit(event.performedBy, 'promotions'))
    demotions.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => credit(event.performedBy, 'demotions'))
    terminations.filter((event) => isInCurrentPeriod(event.terminatedAt, period)).forEach((event) => credit(event.terminatedBy, 'terminations'))
    sanctions.filter((event) => isInCurrentPeriod(event.createdAt, period)).forEach((event) => credit(event.issuedBy, 'sanctions'))
    const staff = [...staffMap.values()].sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName, 'de'))

    const statusCounts = new Map(agentStatusGroups.map((group) => [group.status, group._count._all]))
    const currentAgents = [...statusCounts.entries()].reduce((total, [status, count]) => total + (status === 'TERMINATED' ? 0 : count), 0)
    const trainingCounts = new Map<string, { completed: number; total: number }>()
    for (const group of trainingGroups) {
      const row = trainingCounts.get(group.trainingId) ?? { completed: 0, total: 0 }
      row.total += group._count._all
      if (group.completed) row.completed += group._count._all
      trainingCounts.set(group.trainingId, row)
    }
    const trainingAssignments = [...trainingCounts.values()].reduce((total, row) => total + row.total, 0)
    const completedTrainingAssignments = [...trainingCounts.values()].reduce((total, row) => total + row.completed, 0)
    const rankCounts = new Map(rankGroups.map((group) => [group.rankId, group._count._all]))

    const currentApplications = applications.filter((application) => isInCurrentPeriod(application.submittedAt, period))
    const applicationFunnel = Object.entries(APPLICATION_LABELS).map(([status, label]) => ({
      status,
      label,
      count: currentApplications.filter((application) => application.status === status).length,
    }))

    const latestActivity: StatisticsPayload['latestActivity'] = [
      ...hires.filter((event) => isInCurrentPeriod(event.createdAt, period)).map((event) => ({
        id: `hire-${event.id}`,
        type: 'HIRE' as const,
        title: 'Agent eingestellt',
        subject: agentName(event.agent, event.newValue ?? undefined),
        actor: actorName(event.user),
        createdAt: event.createdAt.toISOString(),
      })),
      ...trainingEvents.filter((event) => isInCurrentPeriod(event.createdAt, period) && countTrainingCompletions(event.newValue) > 0).map((event) => {
        const count = countTrainingCompletions(event.newValue)
        return {
          id: `training-${event.id}`,
          type: 'TRAINING' as const,
          title: `${count} Ausbildung${count === 1 ? '' : 'en'} abgeschlossen`,
          subject: agentName(event.agent),
          actor: actorName(event.user),
          createdAt: event.createdAt.toISOString(),
        }
      }),
      ...rankChanges.filter((event) => isInCurrentPeriod(event.createdAt, period) && event.newRank.sortOrder !== event.oldRank.sortOrder).map((event) => {
        const promotion = event.newRank.sortOrder < event.oldRank.sortOrder
        return {
          id: `rank-${event.id}`,
          type: promotion ? 'PROMOTION' as const : 'DEMOTION' as const,
          title: `${event.oldRank.name} → ${event.newRank.name}`,
          subject: agentName(event.agent),
          actor: actorName(event.performedBy),
          createdAt: event.createdAt.toISOString(),
        }
      }),
      ...terminations.filter((event) => isInCurrentPeriod(event.terminatedAt, period)).map((event) => ({
        id: `termination-${event.id}`,
        type: 'TERMINATION' as const,
        title: 'Dienstverhältnis beendet',
        subject: agentName(event.agent, [event.previousFirstName, event.previousLastName].filter(Boolean).join(' ') || undefined),
        actor: actorName(event.terminatedBy),
        createdAt: event.terminatedAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12)

    const payload: StatisticsPayload = {
      period: {
        range,
        label: period.label,
        start: period.start.toISOString(),
        end: period.end.toISOString(),
      },
      overview,
      additional: {
        currentAgents,
        activeAgents: statusCounts.get('ACTIVE') ?? 0,
        trainingAssignments,
        completedTrainingAssignments,
        trainingCompletionRate: trainingAssignments > 0 ? Math.round((completedTrainingAssignments / trainingAssignments) * 100) : 0,
        agentsWithOpenTrainings: agentsWithOpenTrainings.length,
        applications: metric(applications, (application) => application.submittedAt, period),
        probationStarts: metric(probations, (probation) => probation.createdAt, period),
        newTrainingTypes: metric(newTrainingTypes, (training) => training.createdAt, period),
      },
      series,
      staff,
      rankDistribution: ranks.map((rank) => ({
        id: rank.id,
        label: rank.name,
        color: rank.color,
        count: rankCounts.get(rank.id) ?? 0,
      })).filter((rank) => rank.count > 0),
      trainingDistribution: trainingDefinitions.map((training) => {
        const counts = trainingCounts.get(training.id) ?? { completed: 0, total: 0 }
        return {
          id: training.id,
          label: training.label,
          completed: counts.completed,
          total: counts.total,
          percentage: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
        }
      }).filter((training) => training.total > 0),
      applicationFunnel,
      latestActivity,
    }

    return success(payload)
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (message === 'Forbidden') return error('Keine Berechtigung', 403)
    console.error('[Statistics] Laden fehlgeschlagen:', cause)
    return error(message, 500)
  }
}
