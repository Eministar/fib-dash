'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  GraduationCap,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { cn, formatDateTime } from '@/lib/utils'
import type {
  StatisticsMetric,
  StatisticsPayload,
  StatisticsRange,
  StatisticsSeriesPoint,
  StatisticsStaffRow,
} from '@/lib/statistics'
import { matchesSearch } from '@/lib/search-match'

const rangeOptions: Array<{ value: StatisticsRange; label: string; shortLabel: string }> = [
  { value: 'week', label: 'Diese Woche', shortLabel: 'Woche' },
  { value: '30d', label: 'Letzte 30 Tage', shortLabel: '30 Tage' },
  { value: '90d', label: 'Letzte 90 Tage', shortLabel: '90 Tage' },
  { value: 'year', label: 'Dieses Jahr', shortLabel: 'Jahr' },
]

const seriesLegend: Array<{
  field: keyof Pick<StatisticsSeriesPoint, 'hires' | 'trainingCompletions' | 'promotions' | 'demotions' | 'terminations'>
  label: string
  color: string
}> = [
  { field: 'hires', label: 'Einstellungen', color: '#38bdf8' },
  { field: 'trainingCompletions', label: 'Ausbildungen', color: '#d4d4d4' },
  { field: 'promotions', label: 'Up-Ranks', color: '#34d399' },
  { field: 'demotions', label: 'D-Ranks', color: '#f97316' },
  { field: 'terminations', label: 'Kündigungen', color: '#f87171' },
]

const seriesColor = Object.fromEntries(seriesLegend.map((item) => [item.field, item.color])) as Record<string, string>

const activityMeta: Record<StatisticsPayload['latestActivity'][number]['type'], { icon: LucideIcon; color: string }> = {
  HIRE: { icon: UserPlus, color: seriesColor.hires },
  TRAINING: { icon: GraduationCap, color: seriesColor.trainingCompletions },
  PROMOTION: { icon: ArrowUpRight, color: seriesColor.promotions },
  DEMOTION: { icon: ArrowDownRight, color: seriesColor.demotions },
  TERMINATION: { icon: UserMinus, color: seriesColor.terminations },
}

const funnelColors = ['#38bdf8', '#60a5fa', '#a78bfa', '#34d399', '#f87171']

function DeltaLabel({ metric }: { metric: StatisticsMetric }) {
  const delta = metric.current - metric.previous
  if (delta === 0) return <span className="text-[#8e8e93]">wie Vorperiode</span>
  return (
    <span className={delta > 0 ? 'text-[#6ee7b7]' : 'text-[#fca5a5]'}>
      {delta > 0 ? '▲ +' : '▼ '}{delta} <span className="text-[#8e8e93]">zur Vorperiode</span>
    </span>
  )
}

// Kennzahl ohne Symbolkachel; der Farbpunkt entspricht der Reihe im Diagramm.
function MetricTile({ label, metric, color }: { label: string; metric: StatisticsMetric; color?: string }) {
  return (
    <article className="rounded-[12px] bg-[#1c1c1e] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#98989d]">
        {color && <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden />}
        {label}
      </p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-tight text-white tabular-nums">{metric.current}</p>
      <p className="mt-1.5 truncate text-[11.5px]"><DeltaLabel metric={metric} /></p>
    </article>
  )
}

function Panel({ title, description, aside, className, children }: { title: string; description?: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-[12px] bg-[#1c1c1e] p-4 sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] leading-relaxed text-[#98989d]">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function ActivityChart({ points }: { points: StatisticsSeriesPoint[] }) {
  const totals = points.map((point) => seriesLegend.reduce((total, item) => total + point[item.field], 0))
  const max = Math.max(...totals, 1)
  const labelEvery = Math.max(1, Math.ceil(points.length / 9))

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
        {seriesLegend.map((item) => (
          <span key={item.field} className="inline-flex items-center gap-1.5 text-[11px] text-[#98989d]">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40">
          {[0, 1, 2, 3].map((line) => <span key={line} className="absolute inset-x-0 border-t border-dashed border-white/[0.045]" style={{ top: `${line * 33.333}%` }} />)}
        </div>
        <div className="grid h-[182px] items-end gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((point, index) => {
            const values = seriesLegend.map((item) => point[item.field])
            const total = values.reduce((sum, value) => sum + value, 0)
            const title = `${point.label}: ${seriesLegend.map((item, itemIndex) => `${item.label} ${values[itemIndex]}`).join(', ')}`
            const showLabel = points.length <= 14 || index % labelEvery === 0 || index === points.length - 1
            return (
              <div key={point.key} className="group flex h-full min-w-0 flex-col justify-end" title={title} aria-label={title}>
                <div className="relative flex h-40 flex-col-reverse justify-start overflow-hidden rounded-t-[4px] bg-[#161617]/65 ring-1 ring-inset ring-white/[0.035] transition-colors group-hover:bg-[#2c2c2e]">
                  {seriesLegend.map((item) => {
                    const value = point[item.field]
                    return (
                      <span
                        key={item.field}
                        className="block w-full transition-[filter] group-hover:brightness-125"
                        style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 3 : 0, backgroundColor: item.color }}
                      />
                    )
                  })}
                  {total > 0 && <span className="absolute inset-x-0 top-1 text-center text-[11px] font-semibold text-white/80 tabular-nums">{total}</span>}
                </div>
                <span className={cn('mt-2 truncate text-center text-[11px] text-[#8e8e93]', !showLabel && 'invisible')}>{point.shortLabel}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StaffAvatar({ row }: { row: StatisticsStaffRow }) {
  if (row.avatarUrl) {
    return <span className="h-8 w-8 shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/22" style={{ backgroundImage: `url(${row.avatarUrl})` }} aria-hidden />
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3a3a3c] text-[11px] font-semibold text-[#d4d4d4] ring-1 ring-[#474747]">
      {row.displayName.charAt(0).toUpperCase()}
    </span>
  )
}

function Leader({ label, row, value }: { label: string; row: StatisticsStaffRow | undefined; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-[#8e8e93]">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-white">
        {row ? <>{row.displayName} <span className="text-[#98989d] tabular-nums">· {value}</span></> : <span className="text-[#8e8e93]">–</span>}
      </dd>
    </div>
  )
}

// Nullen treten zurück, damit die tatsächlichen Leistungen in der Tabelle auffallen.
function Count({ value, strong = false }: { value: number; strong?: boolean }) {
  return <td className={cn('px-3 py-2 text-right tabular-nums', strong ? 'pr-4 font-semibold text-white sm:pr-5' : value === 0 ? 'text-[#636366]' : 'text-[#e5e5e5]')}>{value}</td>
}

const staffColumns: Array<{ field: keyof Pick<StatisticsStaffRow, 'hires' | 'trainingCompletions' | 'promotions' | 'demotions' | 'terminations' | 'sanctions'>; label: string }> = [
  { field: 'hires', label: 'Einstellungen' },
  { field: 'trainingCompletions', label: 'Ausbildungen' },
  { field: 'promotions', label: 'Up-Ranks' },
  { field: 'demotions', label: 'D-Ranks' },
  { field: 'terminations', label: 'Kündigungen' },
  { field: 'sanctions', label: 'Sanktionen' },
]

export default function StatisticsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'dashboard:view')
  const [range, setRange] = useState<StatisticsRange>('week')
  const [staffSearch, setStaffSearch] = useState('')
  const { data, loading, error, refetch } = useFetch<StatisticsPayload>(canView ? `/api/statistics?range=${range}` : null)

  const filteredStaff = useMemo(() => {
    return (data?.staff ?? []).filter((row) => matchesSearch(staffSearch, [row.displayName]))
  }, [data?.staff, staffSearch])

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />
  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mt-6 rounded-[12px] bg-[#1c1c1e] px-6 py-16 text-center">
          <AlertTriangle size={22} className="mx-auto text-[#ff6961]" aria-hidden />
          <h1 className="mt-3 text-[16px] font-semibold text-white">Statistik nicht verfügbar</h1>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-[#98989d]">{error ?? 'Die Statistikdaten konnten nicht geladen werden.'}</p>
          <Button size="sm" className="mt-5" onClick={refetch}><RefreshCw size={13} /> Erneut laden</Button>
        </div>
      </div>
    )
  }

  const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  const periodText = `${dateFormat.format(new Date(data.period.start))} – ${dateFormat.format(new Date(data.period.end))}`
  const rankMax = Math.max(...data.rankDistribution.map((rank) => rank.count), 1)
  const recruiter = [...data.staff].sort((a, b) => b.hires - a.hires)[0]
  const trainer = [...data.staff].sort((a, b) => b.trainingCompletions - a.trainingCompletions)[0]
  const rankLead = [...data.staff].sort((a, b) => (b.promotions + b.demotions) - (a.promotions + a.demotions))[0]
  const applicationTotal = data.applicationFunnel.reduce((total, item) => total + item.count, 0)
  const seriesTotal = data.series.reduce((sum, point) => sum + seriesLegend.reduce((value, item) => value + point[item.field], 0), 0)

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-4">
      <PageHeader
        title="Statistiken"
        description={`${data.period.label} · ${periodText} · Vergleich mit der gleich langen Vorperiode`}
        action={(
          <div className="inline-flex gap-[2px] rounded-[9px] bg-[#1c1c1e] p-[3px]" role="group" aria-label="Statistikzeitraum">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                title={option.label}
                className={cn(
                  'rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]/50',
                  range === option.value ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]' : 'text-[#98989d] hover:text-white',
                )}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
        )}
      />

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Kennzahlen">
        <MetricTile label="Einstellungen" metric={data.overview.hires} color={seriesColor.hires} />
        <MetricTile label="Ausbildungen" metric={data.overview.trainingCompletions} color={seriesColor.trainingCompletions} />
        <MetricTile label="Up-Ranks" metric={data.overview.promotions} color={seriesColor.promotions} />
        <MetricTile label="D-Ranks" metric={data.overview.demotions} color={seriesColor.demotions} />
        <MetricTile label="Kündigungen" metric={data.overview.terminations} color={seriesColor.terminations} />
        <MetricTile label="Sanktionen" metric={data.overview.sanctions} />
      </section>

      <Panel
        title="Personalbewegung im Verlauf"
        description="Personalereignisse gestapelt nach Tag, Woche oder Monat."
        aside={<span className="text-[12px] text-[#98989d]">Gesamt <span className="font-semibold text-white tabular-nums">{seriesTotal}</span></span>}
      >
        <ActivityChart points={data.series} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Personalstand nach Rang" description={`${data.additional.activeAgents} von ${data.additional.currentAgents} Agents sind aktuell aktiv.`}>
          <div className="space-y-2">
            {data.rankDistribution.map((rank) => (
              <div key={rank.id} className="grid grid-cols-[minmax(100px,160px)_minmax(0,1fr)_32px] items-center gap-3">
                <span className="truncate text-[12px] font-medium" style={{ color: rank.color }}>{rank.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[#2c2c2e]">
                  <span className="block h-full rounded-full" style={{ width: `${(rank.count / rankMax) * 100}%`, backgroundColor: rank.color }} />
                </span>
                <span className="text-right text-[12px] font-semibold text-[#e5e5e5] tabular-nums">{rank.count}</span>
              </div>
            ))}
            {data.rankDistribution.length === 0 && <p className="py-4 text-[12.5px] text-[#8e8e93]">Keine aktiven Agents vorhanden.</p>}
          </div>
        </Panel>

        <Panel
          title="Ausbildungslage"
          description={`${data.additional.completedTrainingAssignments} von ${data.additional.trainingAssignments} Zuweisungen abgeschlossen · ${data.additional.agentsWithOpenTrainings} Agents mit offenen Ausbildungen.`}
          aside={<span className="text-[20px] font-semibold text-white tabular-nums">{data.additional.trainingCompletionRate}%</span>}
        >
          <div className="space-y-3">
            {data.trainingDistribution.slice(0, 8).map((training) => (
              <div key={training.id}>
                <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate text-[#c7c7cc]">{training.label}</span>
                  <span className="shrink-0 text-[#8e8e93] tabular-nums">{training.completed}/{training.total} · {training.percentage}%</span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-[#2c2c2e]">
                  <span className="block h-full rounded-full bg-[#0a84ff]" style={{ width: `${training.percentage}%` }} />
                </span>
              </div>
            ))}
            {data.trainingDistribution.length === 0 && <p className="py-4 text-[12.5px] text-[#8e8e93]">Keine Ausbildungszuweisungen vorhanden.</p>}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Bewerbungslage"
          description="Im gewählten Zeitraum eingereichte Bewerbungen nach Status."
          aside={(
            <span className="text-right text-[11.5px]">
              <span className="block text-[20px] font-semibold leading-none text-white tabular-nums">{applicationTotal}</span>
              <DeltaLabel metric={data.additional.applications} />
            </span>
          )}
          className="lg:col-span-2"
        >
          {applicationTotal > 0 && (
            <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-[#2c2c2e]" aria-hidden>
              {data.applicationFunnel.map((item, index) => (
                <span key={item.status} className="h-full" style={{ width: `${(item.count / applicationTotal) * 100}%`, backgroundColor: funnelColors[index % funnelColors.length] }} />
              ))}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
            {data.applicationFunnel.map((item, index) => (
              <div key={item.status} className="min-w-0">
                <dt className="flex items-center gap-1.5 truncate text-[12px] text-[#98989d]">
                  <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: funnelColors[index % funnelColors.length] }} aria-hidden />
                  {item.label}
                </dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-white tabular-nums">{item.count}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Weitere Kennzahlen">
          <dl className="divide-y divide-white/[0.06]">
            {[
              { label: 'Neue Probezeiten', metric: data.additional.probationStarts },
              { label: 'Neue Ausbildungsarten', metric: data.additional.newTrainingTypes },
            ].map(({ label, metric }) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <dt className="text-[13px] text-[#c7c7cc]">{label}</dt>
                <dd className="text-right">
                  <span className="text-[15px] font-semibold text-white tabular-nums">{metric.current}</span>
                  <span className="block text-[11.5px]"><DeltaLabel metric={metric} /></span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Panel
        title="Bearbeiterbilanz"
        description="Wer hat im gewählten Zeitraum Einstellungen, Ausbildungen und Personalmaßnahmen bearbeitet?"
        aside={(
          <label className="relative block w-full sm:w-[240px]">
            <span className="sr-only">Bearbeiter suchen</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e8e93]" aria-hidden />
            <input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="Bearbeiter suchen…" className="h-[30px] w-full rounded-[7px] border border-[#48484a] bg-[#161617] pl-8 pr-3 text-[12.5px] text-white outline-none transition-colors placeholder:text-[#8e8e93] focus:border-[#0a84ff] focus:ring-2 focus:ring-[#0a84ff]/30" />
          </label>
        )}
      >
        <dl className="mb-4 grid gap-3 sm:grid-cols-3">
          <Leader label="Meiste Einstellungen" row={recruiter?.hires ? recruiter : undefined} value={recruiter?.hires ?? 0} />
          <Leader label="Meiste Ausbildungen" row={trainer?.trainingCompletions ? trainer : undefined} value={trainer?.trainingCompletions ?? 0} />
          <Leader label="Meiste Rangmaßnahmen" row={rankLead && (rankLead.promotions + rankLead.demotions) > 0 ? rankLead : undefined} value={(rankLead?.promotions ?? 0) + (rankLead?.demotions ?? 0)} />
        </dl>

        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-y border-white/[0.06] text-[12px] text-[#8e8e93]">
                <th scope="col" className="px-4 py-2 font-medium sm:pl-5">Bearbeiter</th>
                {staffColumns.map((column) => <th key={column.field} scope="col" className="px-3 py-2 text-right font-medium">{column.label}</th>)}
                <th scope="col" className="px-3 py-2 pr-4 text-right font-medium text-[#c7c7cc] sm:pr-5">Gesamt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {filteredStaff.map((row, index) => (
                <tr key={row.id} className="transition-colors hover:bg-[#2c2c2e]">
                  <td className="px-4 py-2 sm:pl-5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 text-right text-[11.5px] text-[#636366] tabular-nums">{index + 1}</span>
                      <StaffAvatar row={row} />
                      <span className="max-w-[240px] truncate font-medium text-[#e5e5e5]">{row.displayName}</span>
                    </div>
                  </td>
                  {staffColumns.map((column) => <Count key={column.field} value={row[column.field]} />)}
                  <Count value={row.total} strong />
                </tr>
              ))}
            </tbody>
          </table>
          {filteredStaff.length === 0 && <p className="px-5 py-8 text-center text-[12.5px] text-[#8e8e93]">{staffSearch ? 'Kein Bearbeiter passt zur Suche.' : 'In diesem Zeitraum wurden noch keine Maßnahmen erfasst.'}</p>}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#8e8e93]">Ausbildungen zählen nur, wenn sie neu als abgeschlossen markiert wurden.</p>
      </Panel>

      <Panel title="Neueste Personalbewegungen" description="Die letzten Ereignisse im gewählten Zeitraum.">
        {data.latestActivity.length > 0 ? (
          <ul className="grid gap-x-6 lg:grid-cols-2">
            {data.latestActivity.map((item) => {
              const meta = activityMeta[item.type]
              const Icon = meta.icon
              return (
                <li key={item.id} className="flex items-center gap-3 border-b border-white/[0.06] py-2.5">
                  <Icon size={15} className="shrink-0" style={{ color: meta.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-white">{item.subject}</p>
                    <p className="truncate text-[12px] text-[#8e8e93]">{item.title} · von {item.actor}</p>
                  </div>
                  <time dateTime={item.createdAt} className="shrink-0 text-[11.5px] text-[#8e8e93] tabular-nums">{formatDateTime(item.createdAt)}</time>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="py-4 text-[12.5px] text-[#8e8e93]">Keine Personalbewegungen im gewählten Zeitraum.</p>
        )}
      </Panel>
    </div>
  )
}
