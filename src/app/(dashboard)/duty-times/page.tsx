'use client'

import Link from 'next/link'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock3, LogOut, RefreshCw, Signal, Timer, Trophy, Users, Wifi } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime, formatRelativeTime } from '@/lib/utils'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import { DutyClockCard } from '@/components/duty/duty-clock-card'
import { DutyLeaderboard } from '@/components/duty/duty-leaderboard'

type ApiStatus = 'online' | 'offline' | 'ignored-job' | 'not-linked' | 'not-configured' | 'error'

interface CurrentPlayer {
  source: 'api' | 'session'
  name: string
  identifier: string | null
  steamId: string | null
  job: string | null
  ping: number | null
  playtimeSeconds: number | null
  connectedAt: string | null
}

interface DailyPoint {
  date: string
  label: string
  durationMs: number
  durationLabel: string
}

interface DutyAgent {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  discordId: string | null
  avatarUrl: string | null
  status: string
  rank: { name: string; color: string; sortOrder: number }
  activeSession: { id: string; clockInAt: string; currentDurationMs: number } | null
  activePlaySession: {
    id: string
    startedAt: string
    currentDurationMs: number
    playerName: string
    license: string | null
    lastSeenAt: string
  } | null
  currentPlayer: CurrentPlayer | null
  online: boolean
  scriptConnected: boolean
  lastHeartbeat: string | null
  apiStatus: ApiStatus
  apiError?: string
  weekDurationMs: number
  playtimeWeekDurationMs: number
  totalDurationMs: number
  sessionCount: number
  averageSessionMs: number
  longestSessionMs: number
  lastSeenAt: string | null
  daily: DailyPoint[]
}

interface DutySnapshot {
  now: string
  mode: 'api' | 'manual'
  weekStart: string
  sync: {
    configured: boolean
    checkedAt: string
    onlineCount: number
    errorCount: number
    statusCounts: Record<ApiStatus, number>
    errorSummary: Array<{ message: string; count: number }>
  }
  activeCount: number
  totalActiveDurationMs: number
  totalWeekDurationMs: number
  totalPlaytimeWeekDurationMs: number
  totalAllTimeDurationMs: number
  totalSessionCount: number
  averageSessionMs: number
  longestSessionMs: number
  rows: DutyAgent[]
  activeRows: DutyAgent[]
  topRows: DutyAgent[]
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function agentName(agent: DutyAgent) {
  return `${agent.firstName} ${agent.lastName}`
}

function statusLabel(status: ApiStatus) {
  const labels: Record<ApiStatus, string> = {
    online: 'im Dienst',
    offline: 'offline',
    'ignored-job': 'nicht police',
    'not-linked': 'keine Discord-ID',
    'not-configured': 'nicht konfiguriert',
    error: 'API-Fehler',
  }
  return labels[status]
}

export default function DutyTimesPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'duty-times:view')
  const canManage = hasPermission(user, 'duty-times:manage')
  const { data, loading, error, refetch } = useFetch<DutySnapshot>(canView ? '/api/duty-times' : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [clockingOutId, setClockingOutId] = useState<string | null>(null)

  const clockOutAgent = async (agent: DutyAgent) => {
    setClockingOutId(agent.id)
    try {
      await execute(`/api/duty-times/${agent.id}/clock-out`, { method: 'POST' })
      addToast({ type: 'success', title: 'Ausgestempelt', message: `${agentName(agent)} wurde ausgestempelt.` })
      refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Ausstempeln fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    } finally {
      setClockingOutId(null)
    }
  }

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader withHeader />

  if (error || !data) {
    return (
        <div className="max-w-6xl mx-auto">
          <PageHeader title="Dienstzeiten" description="Live-Übersicht der aktiven Police-Spielzeit" />
          <div className="glass-panel-elevated rounded-[14px] p-8 text-center">
            <AlertTriangle size={26} className="mx-auto text-[#f87171] mb-3" aria-hidden />
            <p className="text-[13px] text-[#98989d] mb-4">{error || 'Dienstzeiten konnten nicht geladen werden'}</p>
            <Button size="sm" onClick={refetch}><RefreshCw size={13} /> Erneut laden</Button>
          </div>
        </div>
    )
  }

  const apiMode = data.mode === 'api'
  const apiState = data.sync.errorCount > 0 ? 'err' : data.sync.configured ? 'ok' : 'warn'
  const description = apiMode
    ? `Automatische Police-Spielzeit · Sync ${formatRelativeTime(data.sync.checkedAt)} · Woche seit ${formatDateTime(data.weekStart)}`
    : 'Manuelle Erfassung: Agents stempeln selbst ein und aus'

  return (
      <div className="max-w-6xl mx-auto space-y-5">
        <PageHeader
            title="Dienstzeiten"
            description={description}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <span className="health-pill ok">
                  <span className="live-pulse" /> {data.activeCount} im Dienst
                </span>
                {apiMode && apiState !== 'ok' && (
                    <span className={cn('health-pill', apiState)}>
                      <Signal size={12} aria-hidden /> {apiState === 'err' ? `API: ${data.sync.errorCount} Fehler` : 'API nicht konfiguriert'}
                    </span>
                )}
                <Button variant="secondary" size="sm" onClick={refetch}><RefreshCw size={13} /> Aktualisieren</Button>
              </div>
            }
        />

        <DutyClockCard onChange={refetch} />

        {apiMode && !data.sync.configured && (
            <div className="rounded-[12px] border border-[#3d2d12] bg-[#1d1608]/80 px-4 py-3 text-[12.5px] text-[#c7c7cc]">
              Player-Online API ist nicht konfiguriert. Historische Spielzeit bleibt sichtbar, Live-Status wird erst mit Server-Env <code>PLAYER_ONLINE_API_SECRET</code> synchronisiert.
            </div>
        )}

        {apiMode && data.sync.errorCount > 0 && (
            <div className="rounded-[12px] border border-[#3b1616] bg-[#1c1111]/80 px-4 py-3 text-[12.5px] text-[#fca5a5]">
              <p>{data.sync.errorCount} Player-Online-Abfragen sind fehlgeschlagen.</p>
              {data.sync.errorSummary.length > 0 && (
                  <ul className="mt-2 space-y-1 font-mono text-[11px] text-[#fecaca]">
                    {data.sync.errorSummary.map((entry) => (
                        <li key={entry.message}>{entry.count}× {entry.message}</li>
                    ))}
                  </ul>
              )}
            </div>
        )}

        {apiMode && data.sync.configured && data.sync.onlineCount === 0 && data.sync.errorCount === 0 && (
            <div className="rounded-[12px] border border-[#454545] bg-[#1c1c1e]/70 px-4 py-3 text-[12px] text-[#98989d]">
              Die API antwortet, meldet aber keinen aktiven Police-Spieler: {data.sync.statusCounts.offline} offline, {data.sync.statusCounts['ignored-job']} mit anderem Job und {data.sync.statusCounts['not-linked']} ohne Discord-Verknüpfung.
            </div>
        )}

        {/* Kennzahlen: vier Hauptwerte groß, Sessions-Statistik als Fußzeile */}
        <section className="glass-panel-elevated rounded-[14px] p-5" aria-label="Kennzahlen">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
            <KpiValue icon={Users} label="Im Dienst" value={String(data.activeCount)} live={data.activeCount > 0} />
            <KpiValue icon={Timer} label="Aktiv jetzt" value={formatDuration(data.totalActiveDurationMs)} />
            <KpiValue icon={Clock3} label="Spielzeit diese Woche" value={formatDuration(data.totalWeekDurationMs)} />
            <KpiValue icon={Trophy} label="Gesamt-Dienstzeit" value={formatDuration(data.totalAllTimeDurationMs)} />
          </div>
          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-[#38383a]/60 pt-4 text-[12px]">
            <InlineStat label="Sessions" value={String(data.totalSessionCount)} />
            <InlineStat label="Ø Session" value={formatDuration(data.averageSessionMs)} />
            <InlineStat label="Längste Session" value={formatDuration(data.longestSessionMs)} />
          </dl>
        </section>

        <DutyLeaderboard
            note={apiMode ? `Sync ${formatRelativeTime(data.sync.checkedAt)}` : undefined}
            weekRows={data.topRows.map((agent) => ({
              ...agent,
              durationMs: agent.weekDurationMs,
              detail: `${agent.sessionCount} Sessions`,
              aside: <StatusPill status={agent.apiStatus} compact />,
            }))}
        />

        <section className="glass-panel-elevated rounded-[14px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="live-pulse" />
              <h3 className="text-[13.5px] font-semibold text-[#fafafa]">Aktuell im Dienst</h3>
              <span className="text-[12px] tabular-nums text-[#8e8e93]">{data.activeRows.length}</span>
            </div>
            {apiMode && <span className="text-[11.5px] text-[#8e8e93]">Online, Script verbunden und Job police</span>}
          </div>

          {data.activeRows.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {data.activeRows.map((agent, index) => (
                    <motion.article
                        key={agent.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: index * 0.03 }}
                        className="rounded-[12px] border border-[#38383a]/60 bg-[#1c1c1e]/80 p-4 transition-colors hover:border-[#48484a]"
                    >
                      <div className="flex items-start gap-3">
                        <AgentAvatar agent={agent} ringColor={agent.rank.color} />
                        <div className="min-w-0 flex-1">
                          <Link href={`/agents/${agent.id}`} className="block truncate text-[14px] font-semibold text-white transition-colors hover:text-[#d4d4d4]">
                            {agentName(agent)}
                          </Link>
                          <p className="mt-0.5 truncate text-[11.5px] text-[#98989d]">
                            <span className="font-mono">#{displayBadgeNumber(agent.badgeNumber)}</span> · {agent.rank.name}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[20px] font-semibold leading-none tabular-nums text-[#86efac]">
                            {formatDuration(agent.activePlaySession?.currentDurationMs ?? agent.activeSession?.currentDurationMs ?? 0)}
                          </p>
                          <p className="mt-1 text-[11px] text-[#8e8e93]">
                            {agent.activePlaySession ? `seit ${formatRelativeTime(agent.activePlaySession.startedAt).replace(/^vor /, '')}` : 'im Dienst'}
                          </p>
                        </div>
                      </div>

                      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[#38383a]/50 pt-3">
                        <InlineStat stacked label="Woche" value={formatDuration(agent.weekDurationMs)} />
                        <InlineStat stacked label="Gesamt" value={formatDuration(agent.totalDurationMs)} />
                        <InlineStat stacked label="Sessions" value={String(agent.sessionCount)} />
                      </dl>

                      {apiMode && (
                          <p className="mt-3 truncate text-[11.5px] text-[#8e8e93]">
                            {[
                              agent.currentPlayer?.name ?? agent.activePlaySession?.playerName,
                              agent.currentPlayer?.ping != null ? `${agent.currentPlayer.ping} ms` : null,
                              agent.lastHeartbeat ? `Heartbeat ${formatRelativeTime(agent.lastHeartbeat)}` : null,
                            ].filter(Boolean).join(' · ') || '—'}
                          </p>
                      )}

                      {apiMode && (agent.currentPlayer?.identifier || agent.activePlaySession?.license || agent.currentPlayer?.steamId) && (
                          <details className="group mt-2">
                            <summary className="w-fit cursor-pointer rounded text-[11.5px] text-[#98989d] hover:text-white">Kennungen anzeigen</summary>
                            <dl className="mt-2 space-y-1.5 rounded-[8px] bg-[#000000]/50 px-3 py-2.5">
                              <IdentityRow label="Identifier" value={agent.currentPlayer?.identifier ?? agent.activePlaySession?.license} />
                              <IdentityRow label="Steam-ID" value={agent.currentPlayer?.steamId} />
                            </dl>
                          </details>
                      )}

                      {data.mode === 'manual' && canManage && (
                          <div className="mt-3 flex justify-end">
                            <Button
                                variant="secondary"
                                size="sm"
                                loading={clockingOutId === agent.id}
                                onClick={() => clockOutAgent(agent)}
                            >
                              <LogOut size={13} /> Ausstempeln
                            </Button>
                          </div>
                      )}
                    </motion.article>
                ))}
              </div>
          ) : (
              <EmptyState icon={Wifi} text="Aktuell ist kein Police-Spieler im Dienst" />
          )}
        </section>

        <section className="glass-panel-elevated rounded-[14px] p-5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-[13.5px] font-semibold text-[#fafafa]">Wochenübersicht pro Spieler</h3>
            <span className="text-[11.5px] text-[#8e8e93]">{data.rows.length} Agents</span>
          </div>
          <p className="text-[12px] text-[#8e8e93] mb-4">
            Alle nicht gekündigten Agents mit Live-Status und Spielzeit der letzten sieben Tage.
          </p>
          <div className="divide-y divide-[#38383a]/40">
            {data.rows.map((agent) => (
                <div key={agent.id} className="grid grid-cols-1 gap-3 py-3.5 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,340px)] lg:items-center lg:gap-6">
                  <div className="min-w-0 flex items-start gap-3">
                    <AgentAvatar agent={agent} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/agents/${agent.id}`} className="truncate text-[13px] font-medium text-white transition-colors hover:text-[#d4d4d4]">
                          {agentName(agent)}
                        </Link>
                        <StatusPill status={agent.apiStatus} compact />
                      </div>
                      <p className="mt-0.5 truncate text-[11.5px] text-[#8e8e93]">
                        <span className="font-mono">#{displayBadgeNumber(agent.badgeNumber)}</span> · {agent.rank.name}
                        {agent.apiStatus !== 'online' && agent.lastSeenAt && <> · zuletzt {formatRelativeTime(agent.lastSeenAt)}</>}
                      </p>
                      {agent.apiError && <p className="mt-1 truncate text-[11px] text-[#fca5a5]">{agent.apiError}</p>}
                    </div>
                  </div>

                  <MiniBars daily={agent.daily} />

                  <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                    <InlineStat stacked strong label="Woche" value={formatDuration(agent.weekDurationMs)} />
                    <InlineStat stacked label="Gesamt" value={formatDuration(agent.totalDurationMs)} />
                    <InlineStat stacked label="Jetzt" value={agent.activePlaySession ? formatDuration(agent.activePlaySession.currentDurationMs) : '—'} />
                    <InlineStat stacked label="Ø" value={formatDuration(agent.averageSessionMs)} />
                    <InlineStat stacked label="Längste" value={formatDuration(agent.longestSessionMs)} />
                  </dl>
                </div>
            ))}
          </div>
        </section>
      </div>
  )
}

function KpiValue({ icon: Icon, label, value, live }: { icon: LucideIcon; label: string; value: string; live?: boolean }) {
  return (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] text-[#98989d]">
          <Icon size={13} strokeWidth={1.8} aria-hidden />
          {label}
        </p>
        <p className={cn('mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.01em] tabular-nums', live ? 'text-[#86efac]' : 'text-white')}>
          {value}
        </p>
      </div>
  )
}

function InlineStat({ label, value, stacked, strong }: { label: string; value: string; stacked?: boolean; strong?: boolean }) {
  if (stacked) {
    return (
        <div className="min-w-0">
          <dt className="text-[11px] text-[#8e8e93]">{label}</dt>
          <dd className={cn('mt-0.5 truncate text-[12.5px] tabular-nums', strong ? 'font-semibold text-white' : 'text-[#d2d2d2]')}>{value}</dd>
        </div>
    )
  }
  return (
      <div className="flex items-baseline gap-1.5">
        <dt className="text-[#8e8e93]">{label}</dt>
        <dd className="font-medium tabular-nums text-[#d2d2d2]">{value}</dd>
      </div>
  )
}

function IdentityRow({ label, value }: { label: string; value?: string | null }) {
  return (
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[11.5px]">
        <dt className="text-[#8e8e93]">{label}</dt>
        <dd className="truncate font-mono text-[#d2d2d2]" title={value || undefined}>{value || '—'}</dd>
      </div>
  )
}

function StatusPill({ status, compact }: { status: ApiStatus; compact?: boolean }) {
  const online = status === 'online'
  const error = status === 'error'
  return (
      <span className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] whitespace-nowrap',
          compact && 'px-2 py-0.5 text-[11px]',
          online
              ? 'border-[#22c55e]/30 bg-[#052e1b]/60 text-[#86efac]'
              : error
                  ? 'border-[#ef4444]/25 bg-[#2a1111]/60 text-[#fca5a5]'
                  : 'border-[#48484a]/60 bg-[#1c1c1e]/60 text-[#98989d]',
      )}>
      {online ? <span className="live-pulse" /> : <span className={cn('h-1.5 w-1.5 rounded-full', error ? 'bg-[#ef4444]' : 'bg-[#808080]')} />}
        {statusLabel(status)}
    </span>
  )
}

function MiniBars({ daily }: { daily: DailyPoint[] }) {
  const max = Math.max(...daily.map((day) => day.durationMs), 1)
  const total = daily.reduce((sum, day) => sum + day.durationMs, 0)
  return (
      <div className="grid grid-cols-7 gap-1.5" role="img" aria-label={`Spielzeit der letzten sieben Tage: ${daily.map((day) => `${day.label} ${day.durationLabel}`).join(', ')}`}>
        {daily.map((day) => {
          const isToday = new Date(day.date).toDateString() === new Date().toDateString()
          return (
              <div key={`${day.date}-${day.label}`} className="min-w-0" title={`${day.label}: ${day.durationLabel}`}>
                <div className="flex h-[32px] items-end rounded-[5px] bg-[#000000]/50 px-[3px]">
                  <div
                      className={cn('w-full rounded-t-[3px]', day.durationMs > 0 ? (isToday ? 'bg-[#64d2ff]' : 'bg-[#0a84ff]/80') : 'bg-transparent')}
                      style={{ height: total > 0 && day.durationMs > 0 ? Math.max(3, Math.round((day.durationMs / max) * 28)) : 0 }}
                  />
                </div>
                <p className={cn('mt-1 truncate text-center text-[10.5px]', isToday ? 'font-semibold text-white' : 'text-[#8e8e93]')}>{day.label}</p>
              </div>
          )
        })}
      </div>
  )
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
      <div className="rounded-[12px] border border-dashed border-[#38383a]/55 bg-[#1c1c1e]/35 px-4 py-12 text-center">
        <Icon size={28} className="mx-auto text-[#d4d4d4]/40 mb-3" aria-hidden />
        <p className="text-[13px] text-[#98989d]">{text}</p>
      </div>
  )
}
