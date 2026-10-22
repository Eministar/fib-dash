'use client'

import { auditActionLabel, auditDetails } from '@/lib/audit-display'
import { DutyClockCard } from '@/components/duty/duty-clock-card'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFetch } from '@/hooks/use-fetch'
import { usePageAction } from '@/hooks/use-page-action'
import { useApi } from '@/hooks/use-api'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DateField } from '@/components/ui/date-field'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn, formatDate, formatDateTime, formatRelativeTime } from '@/lib/utils'
import { AlertTriangle, ArrowRight, CalendarPlus, ChevronRight, Info, RefreshCw, Send } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { hasPermission, type Permission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { RecentItemsCard } from '@/components/dashboard/recent-items-card'
import { AgentOfMonthCard } from '@/components/dashboard/agent-of-month-card'
import { LiveNumber } from '@/components/ui/live-number'
import { checklistProgress } from '@/lib/investigation-templates'
import { INVESTIGATION_STATUS_LABELS } from '@/lib/investigations'

interface RankSummary {
  name: string
  color: string
  sortOrder: number
}

interface AgentPreview {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  status?: string
  hireDate?: string
  lastOnline?: string | null
  updatedAt?: string
  rank: RankSummary
}

interface ActivityItem {
  id: string
  action: string
  oldValue: string | null
  newValue: string | null
  details: string | null
  createdAt: string
  user: { displayName: string } | null
  agent: { id: string; firstName: string; lastName: string; badgeNumber: string } | null
}

interface NotePreview {
  id: string
  title: string | null
  content: string
  createdAt: string
  updatedAt: string
  author: { displayName: string } | null
  agent: { id: string; firstName: string; lastName: string; badgeNumber: string } | null
}

interface ActiveAbsence {
  id: string
  startsAt: string
  endsAt: string
  reason: string
  source: string
  agent: {
    id: string
    badgeNumber: string
    firstName: string
    lastName: string
    discordId: string | null
    rank: RankSummary
  }
}

interface Stats {
  totalAgents: number
  activeAgents: number
  awayAgents: number
  inactiveAgents: number
  terminatedAgents: number
  currentAgents: number
  totalPromotions: number
  recentPromotions: number
  recentTerminations: number
  readinessRate: number
  totalTrainingAssignments: number
  completedTrainingAssignments: number
  trainingCompletionRate: number
  draftRankChangeLists: number
  dutyTimes: {
    activeCount: number
    totalActiveDurationMs: number
    totalWeekDurationMs: number
    activeRows: Array<{
      id: string
      badgeNumber: string
      firstName: string
      lastName: string
      rank: { name: string; color: string; sortOrder: number }
      activeSession: { id: string; clockInAt: string; currentDurationMs: number } | null
      weekDurationMs: number
    }>
  } | null
  activeAbsences: ActiveAbsence[]
  recentWindowDays: number
  rankDistribution: { rank: string; color: string; count: number }[]
  statusDistribution: { status: string; label: string; count: number }[]
  trainingBreakdown: { id: string; label: string; completed: number; total: number; percentage: number }[]
  attentionAgents: AgentPreview[]
  recentHires: AgentPreview[]
  recentActivity: ActivityItem[]
  pinnedNotes: NotePreview[]
  notifications: Array<{
    id: string
    severity: 'info' | 'warning' | 'error'
    title: string
    description: string
    href: string
  }>
}

interface MyInvestigation {
  id: string
  caseNumber: string
  title: string
  status: keyof typeof INVESTIGATION_STATUS_LABELS
  checklist: unknown
  updatedAt: string
}

type StatKey = 'activeAgents' | 'awayAgents' | 'inactiveAgents' | 'currentAgents' | 'recentPromotions' | 'recentTerminations'

// Kennzahlen ohne Symbolkacheln: Zahl und Beschriftung reichen, Farbe bleibt Statusmeldungen vorbehalten.
const statCards: { key: StatKey; label: string; href: string; permission: Permission; hint?: string }[] = [
  { key: 'currentAgents', label: 'Personalbestand', href: '/agents', permission: 'agents:view', hint: 'ohne Ausgeschiedene' },
  { key: 'activeAgents', label: 'Aktiv', href: '/agents?status=ACTIVE', permission: 'agents:view' },
  { key: 'awayAgents', label: 'Abwesend', href: '/agents?status=ABSENT', permission: 'agents:view', hint: 'abgemeldet & beurlaubt' },
  { key: 'inactiveAgents', label: 'Inaktiv', href: '/agents?status=INACTIVE', permission: 'agents:view' },
  { key: 'recentPromotions', label: 'Rangänderungen', href: '/promotions', permission: 'rank-changes:view' },
  { key: 'recentTerminations', label: 'Kündigungen', href: '/terminations', permission: 'terminations:view' },
]

// Listen auf der Übersicht sind Vorschauen – alles Weitere hinter „Alle ansehen“.
const PREVIEW_LIMIT = 5

const rowClass = '-mx-2 flex items-center justify-between gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-[#2c2c2e]'

function Panel({
  title,
  count,
  href,
  hrefLabel = 'Alle ansehen',
  empty,
  isEmpty = count === 0,
  className,
  children,
}: {
  title: string
  /** Zähler neben dem Titel – nur für echte Gesamtzahlen, nicht für gekürzte Vorschauen. */
  count?: number
  isEmpty?: boolean
  href?: string | null
  hrefLabel?: string
  /** Kurzer Leertext statt großer Leerzustands-Grafik. */
  empty?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-white">
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-[#2c2c2e] px-1.5 font-mono text-[11px] font-medium text-[#98989d]">{count}</span>
          )}
        </h2>
        {href && (
          <Link href={href} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[#98989d] transition-colors hover:text-white">
            {hrefLabel}
            <ChevronRight size={13} strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      {isEmpty && empty ? <p className="py-2 text-[12.5px] text-[#8e8e93]">{empty}</p> : children}
    </Card>
  )
}

function notificationTone(severity: 'info' | 'warning' | 'error') {
  if (severity === 'error') return { className: 'text-[#ff6961]', icon: AlertTriangle, label: 'Dringend' }
  if (severity === 'warning') return { className: 'text-[#ffb340]', icon: AlertTriangle, label: 'Warnung' }
  return { className: 'text-[#8e8e93]', icon: Info, label: 'Hinweis' }
}

function agentName(agent: { firstName: string; lastName: string }) {
  return `${agent.firstName} ${agent.lastName}`
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateAfterDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dateInputValue(date)
}

function StatTile({ label, value, hint, href }: { label: string; value: number; hint?: string; href: string }) {
  return (
    <Link href={href} className="group block rounded-[12px] bg-[#1c1c1e] px-4 py-3 transition-colors hover:bg-[#2c2c2e]">
      <p className="text-[12px] font-medium text-[#98989d] group-hover:text-[#c7c7cc]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-tight text-white tabular-nums"><LiveNumber value={value} /></p>
      {hint && <p className="mt-1.5 truncate text-[11.5px] text-[#8e8e93]">{hint}</p>}
    </Link>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { execute } = useApi()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const canViewDashboard = hasPermission(user, 'dashboard:view')
  // Externe Ermittler haben keine Übersicht – Login und Logo führen sie direkt zu den Akten.
  const investigationsOnly = !canViewDashboard && hasPermission(user, 'investigations:view')
  const canManageAbsences = hasPermission(user, 'agents:write')
  const { data: stats, loading, error, refetch } = useFetch<Stats>(canViewDashboard ? '/api/stats' : null)
  const canViewInvestigations = hasPermission(user, 'investigations:view')
  const { data: myInvestigations } = useFetch<MyInvestigation[]>(
      canViewDashboard && canViewInvestigations ? '/api/investigations?mine=1&status=OPEN_ONLY' : null,
  )
  const [absenceModalOpen, setAbsenceModalOpen] = useState(false)
  const { data: absenceAgents } = useFetch<AgentPreview[]>(canManageAbsences && absenceModalOpen ? '/api/agents' : null)
  const [absenceAgentId, setAbsenceAgentId] = useState('')
  const [absenceDuration, setAbsenceDuration] = useState('3')
  const [absenceEndsAt, setAbsenceEndsAt] = useState(dateAfterDays(3))
  const [absenceReason, setAbsenceReason] = useState('')
  const [absenceSubmitting, setAbsenceSubmitting] = useState(false)
  const [clock, setClock] = useState<Date | null>(null)

  useEffect(() => {
    if (investigationsOnly) router.replace('/investigations')
  }, [investigationsOnly, router])

  useEffect(() => {
    setClock(new Date())
    const t = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const dateLine = useMemo(
      () =>
          new Intl.DateTimeFormat('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(new Date()),
      []
  )
  const timeLine = useMemo(() => {
    if (!clock) return null
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(clock)
  }, [clock])
  const greeting = useMemo(() => {
    const h = (clock ?? new Date()).getHours()
    if (h < 5) return 'Gute Nacht'
    if (h < 11) return 'Guten Morgen'
    if (h < 17) return 'Guten Tag'
    if (h < 22) return 'Guten Abend'
    return 'Gute Nacht'
  }, [clock])

  const absenceAgentOptions = useMemo(() => {
    const ownOption = user?.discordId ? [{ value: '', label: 'Eigene Abmeldung' }] : []
    const agentOptions = (absenceAgents ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.firstName} ${agent.lastName} #${displayBadgeNumber(agent.badgeNumber)}`,
    }))
    return [...ownOption, ...agentOptions]
  }, [absenceAgents, user?.discordId])
  const canSubmitAbsence = !!absenceReason.trim() && !!absenceEndsAt && (!!user?.discordId || !!absenceAgentId)

  const openAbsenceModal = () => {
    setAbsenceAgentId('')
    setAbsenceDuration('3')
    setAbsenceEndsAt(dateAfterDays(3))
    setAbsenceReason('')
    setAbsenceModalOpen(true)
  }
  usePageAction('absence', openAbsenceModal, Boolean(user?.discordId) || canManageAbsences)

  const updateAbsenceDuration = (value: string) => {
    setAbsenceDuration(value)
    const days = Number.parseInt(value, 10)
    if (Number.isFinite(days) && days > 0) setAbsenceEndsAt(dateAfterDays(days))
  }

  const submitAbsence = async () => {
    if (!absenceReason.trim()) {
      addToast({ type: 'error', title: 'Grund fehlt' })
      return
    }
    if (!user?.discordId && !absenceAgentId) {
      addToast({ type: 'error', title: 'Agent fehlt' })
      return
    }

    setAbsenceSubmitting(true)
    try {
      const payload: { reason: string; endsAt: string; agentId?: string } = {
        reason: absenceReason.trim(),
        endsAt: absenceEndsAt,
      }
      if (canManageAbsences && absenceAgentId) payload.agentId = absenceAgentId

      await execute('/api/absences', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      addToast({ type: 'success', title: 'Abmeldung eingetragen' })
      setAbsenceModalOpen(false)
      notifyLiveUpdate()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Abmeldung fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setAbsenceSubmitting(false)
    }
  }

  const cancelAbsence = async (absence: ActiveAbsence) => {
    const confirmed = await confirm({
      title: 'Abmeldung beenden?',
      description: `${agentName(absence.agent)} gilt danach sofort wieder als anwesend.`,
      confirmLabel: 'Beenden',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await execute(`/api/absences/${absence.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Abmeldung beendet' })
      notifyLiveUpdate()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Abmeldung konnte nicht beendet werden', message: err instanceof Error ? err.message : '' })
    }
  }

  if (investigationsOnly) return <PageLoader />
  if (!canViewDashboard) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  if (error || !stats) {
    return (
        <div className="max-w-6xl mx-auto">
          <Card className="mt-6 px-6 py-16 text-center">
            <AlertTriangle size={22} className="mx-auto mb-3 text-[#ff6961]" strokeWidth={1.75} aria-hidden />
            <h2 className="text-[15px] font-semibold text-white mb-1">Dashboard nicht verfügbar</h2>
            <p className="text-[12.5px] text-[#98989d] mb-5 max-w-md mx-auto">{error || 'Die Dashboard-Daten konnten gerade nicht geladen werden.'}</p>
            <Button size="sm" onClick={refetch}>
              <RefreshCw size={13} strokeWidth={2} />
              Erneut laden
            </Button>
          </Card>
        </div>
    )
  }

  const visibleStats = statCards.filter((card) => hasPermission(user, card.permission))
  const inactiveAgents = stats.attentionAgents.filter((agent) => agent.status === 'INACTIVE')
  const canViewRankChanges = hasPermission(user, 'rank-changes:view')

  return (
      <div className="max-w-7xl mx-auto space-y-4 pb-4">
        <DutyClockCard />

        {/* Kopf: Begrüßung links, genau eine Hauptaktion rechts */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-[24px] font-semibold text-white tracking-[-0.02em] leading-tight">
              {greeting}{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}
            </h1>
            <p className="mt-1 text-[13px] text-[#98989d]">
              {dateLine}{timeLine && <span className="tabular-nums"> · {timeLine} Uhr</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={refetch} aria-label="Übersicht aktualisieren" title="Aktualisieren" className="w-[30px] px-0">
              <RefreshCw size={14} strokeWidth={2} />
            </Button>
            <Button
                size="sm"
                onClick={openAbsenceModal}
                disabled={!user?.discordId && !canManageAbsences}
                title={!user?.discordId && !canManageAbsences ? 'Dein Dashboard-User braucht eine Discord-ID.' : undefined}
            >
              <CalendarPlus size={13} strokeWidth={2} />
              Abwesenheit melden
            </Button>
          </div>
        </header>

        {/* Kennzahlen */}
        {(visibleStats.length > 0 || stats.dutyTimes) && (
            <section aria-label="Kennzahlen" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
              {stats.dutyTimes && (
                  <StatTile
                      label="Im Dienst"
                      value={stats.dutyTimes.activeCount}
                      hint={`${formatDuration(stats.dutyTimes.totalWeekDurationMs)} diese Woche`}
                      href="/duty-times"
                  />
              )}
              {visibleStats.map((card) => (
                  <StatTile
                      key={card.key}
                      label={card.label}
                      value={stats[card.key]}
                      hint={card.key === 'recentPromotions' || card.key === 'recentTerminations' ? `letzte ${stats.recentWindowDays} Tage` : card.hint}
                      href={card.href}
                  />
              ))}
            </section>
        )}

        {/* Hinweise erscheinen nur, wenn es etwas zu tun gibt */}
        {stats.notifications.length > 0 && (
            <Panel title="Hinweise" count={stats.notifications.length}>
              <ul className="grid gap-x-6 lg:grid-cols-2">
                {stats.notifications.map((item) => {
                  const tone = notificationTone(item.severity)
                  const Icon = tone.icon
                  return (
                      <li key={item.id}>
                        <Link href={item.href} className={cn(rowClass, 'group items-start')}>
                          <Icon size={14} className={cn('mt-0.5 shrink-0', tone.className)} strokeWidth={2} aria-label={tone.label} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium text-white">{item.title}</span>
                            <span className="mt-0.5 block text-[12px] leading-relaxed text-[#98989d]">{item.description}</span>
                          </span>
                          <ArrowRight size={13} className="mt-0.5 shrink-0 text-[#8e8e93] transition-colors group-hover:text-white" strokeWidth={1.85} aria-hidden />
                        </Link>
                      </li>
                  )
                })}
              </ul>
            </Panel>
        )}

        <RecentItemsCard />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Hauptspalte: was heute los ist */}
          <div className="space-y-4 xl:col-span-2">
            <Panel title="Aktuelle Abmeldungen" count={stats.activeAbsences.length} empty="Aktuell ist niemand abgemeldet.">
              <ul>
                {stats.activeAbsences.map((absence) => {
                  const canCancel = canManageAbsences || (!!user?.discordId && absence.agent.discordId === user.discordId)
                  return (
                      <li key={absence.id} className={cn(rowClass, 'items-start hover:bg-transparent')}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px]">
                            <Link href={`/agents/${absence.agent.id}`} className="font-medium text-white hover:underline">
                              {agentName(absence.agent)}
                            </Link>
                            <span className="ml-1.5 font-mono text-[12px] text-[#8e8e93]">#{displayBadgeNumber(absence.agent.badgeNumber)}</span>
                            <span className="text-[12px] text-[#8e8e93]"> · {absence.agent.rank.name}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-[#c7c7cc]">{absence.reason}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                              className="text-[12px] text-[#98989d] tabular-nums"
                              title={`${formatDateTime(absence.startsAt)} → ${formatDateTime(absence.endsAt)}`}
                          >
                            bis {formatDate(absence.endsAt)}
                          </span>
                          {canCancel && (
                              <Button variant="ghost" size="sm" onClick={() => cancelAbsence(absence)} className="text-[#ff6961] hover:text-[#ff6961]">
                                Beenden
                              </Button>
                          )}
                        </div>
                      </li>
                  )
                })}
              </ul>
            </Panel>

            <Panel
                title="Aktuelle Aktivitäten"
                isEmpty={stats.recentActivity.length === 0}
                href={hasPermission(user, 'logs:view') ? '/logs' : null}
                empty="Noch keine Aktivitäten im Protokoll."
            >
              <ul className="divide-y divide-white/[0.06]">
                {stats.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-1 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-[13px]">
                          <span className="font-medium text-white">{auditActionLabel(entry.action)}</span>
                          {entry.agent && (
                              <>
                                <span className="text-[#8e8e93]"> · </span>
                                <Link href={`/agents/${entry.agent.id}`} className="text-[#c7c7cc] hover:text-white hover:underline">
                                  {agentName(entry.agent)}
                                </Link>
                              </>
                          )}
                        </p>
                        {entry.details && <p className="mt-0.5 text-[12px] text-[#98989d]">{auditDetails(entry.details)}</p>}
                        {entry.oldValue && entry.newValue && (
                            <p className="mt-0.5 text-[12px] text-[#98989d]">
                              <span className="line-through opacity-70">{entry.oldValue}</span>
                              <span className="mx-1.5">→</span>
                              <span className="text-[#c7c7cc]">{entry.newValue}</span>
                            </p>
                        )}
                      </div>
                      <p className="shrink-0 text-right text-[11.5px] leading-snug text-[#8e8e93]">
                        {formatRelativeTime(entry.createdAt)}
                        <span className="block">{entry.user?.displayName ?? 'Gelöscht'}</span>
                      </p>
                    </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* Seitenspalte: kurze Vorschauen */}
          <div className="space-y-4">
            {canViewInvestigations && (
                <Panel
                    title="Meine Akten"
                    count={myInvestigations?.length}
                    isEmpty={myInvestigations?.length === 0}
                    href={myInvestigations && myInvestigations.length > 0 ? '/investigations?mine=1' : null}
                    empty="Du führst gerade keine laufende Akte und bist keiner zugewiesen."
                >
                  <ul>
                    {(myInvestigations ?? []).slice(0, PREVIEW_LIMIT).map((investigation) => {
                      const progress = checklistProgress(investigation.checklist)
                      return (
                          <li key={investigation.id}>
                            <Link href={`/investigations/${investigation.id}`} className={rowClass}>
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-medium text-white">{investigation.title}</span>
                                <span className="block truncate text-[11.5px] text-[#8e8e93]">
                                  <span className="font-mono">{investigation.caseNumber}</span> · {INVESTIGATION_STATUS_LABELS[investigation.status]}
                                </span>
                              </span>
                              {progress && (
                                  <span className="shrink-0 text-[12px] text-[#98989d] tabular-nums" title="Arbeitsplan erledigt">
                                    {progress.done}/{progress.total}
                                  </span>
                              )}
                            </Link>
                          </li>
                      )
                    })}
                  </ul>
                </Panel>
            )}

            <Panel title="Stand">
              <ul>
                {canViewRankChanges && (
                    <li>
                      <Link href="/promotions" className={rowClass}>
                        <span className="text-[13px] text-[#c7c7cc]">Offene Rangänderungslisten</span>
                        <span className="text-[13px] font-semibold text-white tabular-nums">{stats.draftRankChangeLists}</span>
                      </Link>
                    </li>
                )}
                <li>
                  <Link href="/dashboard?view=statistics" className={rowClass}>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-[#c7c7cc]">Ausbildungsstand</span>
                      <span className="block text-[11.5px] text-[#8e8e93]">
                        {stats.totalTrainingAssignments > 0
                            ? `${stats.completedTrainingAssignments} von ${stats.totalTrainingAssignments} erledigt`
                            : 'Keine Ausbildungen zugewiesen'}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold text-white tabular-nums">{stats.trainingCompletionRate}%</span>
                  </Link>
                </li>
              </ul>
            </Panel>

            <Panel
                title="Inaktive Agents"
                count={stats.inactiveAgents}
                isEmpty={inactiveAgents.length === 0}
                href={stats.inactiveAgents > inactiveAgents.length ? '/agents?status=INACTIVE' : null}
                empty="Keine inaktiven Agents."
            >
              <ul>
                {inactiveAgents.slice(0, PREVIEW_LIMIT).map((agent) => (
                    <li key={agent.id}>
                      <Link href={`/agents/${agent.id}`} className={rowClass}>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-white">{agentName(agent)}</span>
                          <span className="block truncate text-[11.5px] text-[#8e8e93]">
                            {agent.rank.name} · {agent.lastOnline ? `online ${formatRelativeTime(agent.lastOnline)}` : `aktualisiert ${formatDate(agent.updatedAt)}`}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-[#8e8e93]">#{displayBadgeNumber(agent.badgeNumber)}</span>
                      </Link>
                    </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Angepinnte Notizen" count={stats.pinnedNotes.length} href="/notes" hrefLabel="Notizen">
              {stats.pinnedNotes.length > 0 ? (
                  <ul>
                    {stats.pinnedNotes.map((note) => (
                        <li key={note.id}>
                          <Link href={note.agent ? `/agents/${note.agent.id}` : '/notes'} className={cn(rowClass, 'block')}>
                            <span className="block text-[13px] font-medium text-white">{note.title || 'Notiz'}</span>
                            <span className="mt-0.5 block line-clamp-2 text-[12px] leading-relaxed text-[#98989d]">{note.content}</span>
                            <span className="mt-1 block text-[11.5px] text-[#8e8e93]">
                              {note.agent ? `${agentName(note.agent)} · ` : ''}{note.author?.displayName ?? 'Gelöscht'}
                            </span>
                          </Link>
                        </li>
                    ))}
                  </ul>
              ) : (
                  <p className="py-2 text-[12.5px] text-[#8e8e93]">Angepinnte Notizen erscheinen hier.</p>
              )}
            </Panel>

            <Panel title="Neue Agents" isEmpty={stats.recentHires.length === 0} empty="Noch keine Agents eingestellt.">
              <ul>
                {stats.recentHires.slice(0, PREVIEW_LIMIT).map((agent) => (
                    <li key={agent.id}>
                      <Link href={`/agents/${agent.id}`} className={rowClass}>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-white">{agentName(agent)}</span>
                          <span className="block truncate text-[11.5px] text-[#8e8e93]">{agent.rank.name}</span>
                        </span>
                        <span className="shrink-0 text-[12px] text-[#98989d] tabular-nums">{formatDate(agent.hireDate)}</span>
                      </Link>
                    </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <AgentOfMonthCard />

        <Modal open={absenceModalOpen} onClose={() => setAbsenceModalOpen(false)} title="Abmeldung eintragen" description="Trage eine Abwesenheit ein – sie endet automatisch zum gewählten Datum.">
          <div className="space-y-4">
            {canManageAbsences && (
                <Select
                    label="Agent"
                    value={absenceAgentId}
                    onValueChange={setAbsenceAgentId}
                    options={absenceAgentOptions}
                    placeholder={user?.discordId ? 'Eigene Abmeldung oder Agent wählen' : 'Agent wählen...'}
                />
            )}
            <Select
                label="Dauer"
                value={absenceDuration}
                onValueChange={updateAbsenceDuration}
                options={[
                  { value: '1', label: '1 Tag' },
                  { value: '2', label: '2 Tage' },
                  { value: '3', label: '3 Tage' },
                  { value: '5', label: '5 Tage' },
                  { value: '7', label: '1 Woche' },
                  { value: '14', label: '2 Wochen' },
                ]}
            />
            <DateField
                label="Abgemeldet bis"
                value={absenceEndsAt}
                onChange={(value) => {
                  setAbsenceDuration('')
                  setAbsenceEndsAt(value)
                }}
                allowClear={false}
            />
            <Textarea
                label="Grund"
                value={absenceReason}
                onChange={(event) => setAbsenceReason(event.target.value)}
                rows={4}
                placeholder="Grund der Abmeldung..."
                required
            />
            {!user?.discordId && !canManageAbsences && (
                <p className="rounded-[10px] border border-[#3d2d12] bg-[#1d1608] px-3.5 py-2.5 text-[12px] text-[#c7c7cc] leading-relaxed">
                  Dein Dashboard-User braucht eine Discord-ID, damit die Abmeldung deinem Agent zugeordnet werden kann.
                </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setAbsenceModalOpen(false)}>Abbrechen</Button>
              <Button size="sm" onClick={submitAbsence} loading={absenceSubmitting} disabled={!canSubmitAbsence}>
                <Send size={13} strokeWidth={2} />
                Eintragen
              </Button>
            </div>
          </div>
        </Modal>
      </div>
  )
}
