'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
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

const panelClass = 'rounded-[16px] border border-[#323232]/55 bg-[#1b1b1b]/72 shadow-[0_1px_2px_rgba(0,0,0,.14),0_14px_36px_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.025)]'
const surfaceClass = 'rounded-[11px] border border-white/[0.055] bg-[#181818]/55'

const rangeOptions: Array<{ value: StatisticsRange; label: string; shortLabel: string }> = [
  { value: 'week', label: 'Diese Woche', shortLabel: 'Woche' },
  { value: '30d', label: 'Letzte 30 Tage', shortLabel: '30 Tage' },
  { value: '90d', label: 'Letzte 90 Tage', shortLabel: '90 Tage' },
  { value: 'year', label: 'Dieses Jahr', shortLabel: 'Jahr' },
]

type MetricTone = 'emerald' | 'sky' | 'gold' | 'rose' | 'amber' | 'violet'

const tones: Record<MetricTone, { color: string; bg: string; border: string }> = {
  emerald: { color: '#34d399', bg: 'rgba(52,211,153,.10)', border: 'rgba(52,211,153,.24)' },
  sky: { color: '#38bdf8', bg: 'rgba(56,189,248,.10)', border: 'rgba(56,189,248,.24)' },
  gold: { color: '#d4d4d4', bg: 'rgba(212,212,212,.11)', border: 'rgba(212,212,212,.26)' },
  rose: { color: '#f87171', bg: 'rgba(248,113,113,.10)', border: 'rgba(248,113,113,.24)' },
  amber: { color: '#fbbf24', bg: 'rgba(251,191,36,.10)', border: 'rgba(251,191,36,.24)' },
  violet: { color: '#a78bfa', bg: 'rgba(167,139,250,.10)', border: 'rgba(167,139,250,.24)' },
}

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

const activityMeta: Record<StatisticsPayload['latestActivity'][number]['type'], { icon: LucideIcon; color: string; bg: string }> = {
  HIRE: { icon: UserPlus, color: '#38bdf8', bg: 'rgba(56,189,248,.11)' },
  TRAINING: { icon: GraduationCap, color: '#d4d4d4', bg: 'rgba(212,212,212,.11)' },
  PROMOTION: { icon: ArrowUpRight, color: '#34d399', bg: 'rgba(52,211,153,.11)' },
  DEMOTION: { icon: ArrowDownRight, color: '#f97316', bg: 'rgba(249,115,22,.11)' },
  TERMINATION: { icon: UserMinus, color: '#f87171', bg: 'rgba(248,113,113,.11)' },
}

function DeltaLabel({ metric }: { metric: StatisticsMetric }) {
  const delta = metric.current - metric.previous
  if (delta === 0) return <span className="text-[#797979]">wie zuvor</span>
  return (
    <span className={delta > 0 ? 'text-[#6ee7b7]' : 'text-[#fca5a5]'}>
      {delta > 0 ? '+' : ''}{delta} zur Vorperiode
    </span>
  )
}

function MetricCard({
  label,
  metric,
  icon: Icon,
  tone,
  hint,
}: {
  label: string
  metric: StatisticsMetric
  icon: LucideIcon
  tone: MetricTone
  hint: string
}) {
  const color = tones[tone]
  return (
    <article className={cn(panelClass, 'group relative overflow-hidden p-4 transition-colors hover:border-[#484848]')}>
      <span className="absolute inset-x-0 top-0 h-px opacity-80" style={{ background: `linear-gradient(90deg, transparent, ${color.color}, transparent)` }} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#868686]">{label}</p>
          <p className="mt-2 text-[27px] font-semibold leading-none tracking-[-0.035em] text-white tabular-nums">{metric.current}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border" style={{ color: color.color, backgroundColor: color.bg, borderColor: color.border }}>
          <Icon size={17} strokeWidth={1.9} />
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10.5px]">
        <DeltaLabel metric={metric} />
        <span className="truncate text-[#656565]" title={hint}>{hint}</span>
      </div>
    </article>
  )
}

function SectionHeading({ icon: Icon, title, description, aside }: { icon: LucideIcon; title: string; description: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[#d4d4d4]/18 bg-[#d4d4d4]/9 text-[#d4d4d4]">
          <Icon size={15} strokeWidth={1.9} />
        </span>
        <div>
          <h2 className="text-[13.5px] font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-[#838383]">{description}</p>
        </div>
      </div>
      {aside}
    </div>
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
          <span key={item.field} className="inline-flex items-center gap-1.5 text-[10.5px] text-[#a6a6a6]">
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
                <div className="relative flex h-40 flex-col-reverse justify-start overflow-hidden rounded-t-[4px] bg-[#161616]/65 ring-1 ring-inset ring-white/[0.035] transition-colors group-hover:bg-[#222222]">
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
                  {total > 0 && <span className="absolute inset-x-0 top-1 text-center text-[9px] font-semibold text-white/75 tabular-nums">{total}</span>}
                </div>
                <span className={cn('mt-2 truncate text-center text-[9px] text-[#686868]', !showLabel && 'invisible')}>{point.shortLabel}</span>
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
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#333333] text-[11px] font-semibold text-[#d4d4d4] ring-1 ring-[#474747]">
      {row.displayName.charAt(0).toUpperCase()}
    </span>
  )
}

function LeaderCard({ label, row, value, icon: Icon }: { label: string; row: StatisticsStaffRow | undefined; value: number; icon: LucideIcon }) {
  return (
    <div className={cn(surfaceClass, 'flex min-w-0 items-center gap-3 px-3 py-2.5')}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#d4d4d4]/10 text-[#d4d4d4]"><Icon size={14} /></span>
      <div className="min-w-0">
        <p className="text-[9.5px] uppercase tracking-[0.12em] text-[#686868]">{label}</p>
        <p className="mt-0.5 truncate text-[11.5px] font-medium text-[#e5e5e5]">{row ? `${row.displayName} · ${value}` : 'Noch keine Daten'}</p>
      </div>
    </div>
  )
}

export default function StatisticsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'dashboard:view')
  const [range, setRange] = useState<StatisticsRange>('week')
  const [staffSearch, setStaffSearch] = useState('')
  const { data, loading, error, refetch } = useFetch<StatisticsPayload>(canView ? `/api/statistics?range=${range}` : null)

  const filteredStaff = useMemo(() => {
    const query = staffSearch.trim().toLocaleLowerCase('de-DE')
    return (data?.staff ?? []).filter((row) => !query || row.displayName.toLocaleLowerCase('de-DE').includes(query))
  }, [data?.staff, staffSearch])

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />
  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className={cn(panelClass, 'mt-6 px-6 py-16 text-center')}>
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]"><AlertTriangle size={22} /></span>
          <h1 className="mt-4 text-[16px] font-semibold text-white">Statistik nicht verfügbar</h1>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-[#a6a6a6]">{error ?? 'Die Statistikdaten konnten nicht geladen werden.'}</p>
          <Button size="sm" className="mt-5" onClick={refetch}><RefreshCw size={13} /> Erneut laden</Button>
        </div>
      </div>
    )
  }

  const periodText = `${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(data.period.start))} – ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(data.period.end))}`
  const rankMax = Math.max(...data.rankDistribution.map((rank) => rank.count), 1)
  const recruiter = [...data.staff].sort((a, b) => b.hires - a.hires)[0]
  const trainer = [...data.staff].sort((a, b) => b.trainingCompletions - a.trainingCompletions)[0]
  const rankLead = [...data.staff].sort((a, b) => (b.promotions + b.demotions) - (a.promotions + a.demotions))[0]
  const applicationTotal = data.applicationFunnel.reduce((total, item) => total + item.count, 0)

  return (
    <div className="mx-auto max-w-[1500px] pb-4">
      <PageHeader
        eyebrow="Personalführung · Lagebericht"
        title="Statistik & Entwicklung"
        description="Personalbewegungen, Ausbildungsstand und Bearbeiterleistung transparent überblicken. Alle Vergleiche beziehen sich auf den gleich langen vorherigen Zeitraum."
        action={(
          <div className="inline-flex rounded-[10px] border border-[#404040]/70 bg-[#161616]/75 p-1" role="group" aria-label="Statistikzeitraum">
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                title={option.label}
                className={cn(
                  'h-8 rounded-[7px] px-2.5 text-[10.5px] font-semibold transition-colors sm:px-3',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40',
                  range === option.value ? 'bg-[#d4d4d4] text-[#181818] shadow-[0_2px_8px_rgba(212,212,212,.2)]' : 'text-[#909090] hover:bg-[#282828] hover:text-white',
                )}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#353535]/55 bg-[#181818]/65 px-3.5 py-2 text-[10.5px]">
        <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-[0.12em] text-[#d4d4d4]"><Activity size={12} /> {data.period.label}</span>
        <span className="font-mono text-[#797979]">{periodText}</span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="Kennzahlen">
        <MetricCard label="Einstellungen" metric={data.overview.hires} icon={UserPlus} tone="sky" hint="im System angelegt" />
        <MetricCard label="Ausbildungen" metric={data.overview.trainingCompletions} icon={GraduationCap} tone="gold" hint="neu abgeschlossen" />
        <MetricCard label="Up-Ranks" metric={data.overview.promotions} icon={ArrowUpRight} tone="emerald" hint="durchgeführt" />
        <MetricCard label="D-Ranks" metric={data.overview.demotions} icon={ArrowDownRight} tone="amber" hint="durchgeführt" />
        <MetricCard label="Kündigungen" metric={data.overview.terminations} icon={UserMinus} tone="rose" hint="Dienst beendet" />
        <MetricCard label="Sanktionen" metric={data.overview.sanctions} icon={ShieldAlert} tone="violet" hint="neu ausgestellt" />
      </section>

      <section className={cn(panelClass, 'mt-3 p-4 sm:p-5')}>
        <SectionHeading icon={BarChart3} title="Personalbewegung im Verlauf" description="Alle erfassten Personalereignisse nach Tag, Woche oder Monat gestapelt." aside={<span className="font-mono text-[10px] text-[#686868]">GESAMT {data.series.reduce((sum, point) => sum + seriesLegend.reduce((value, item) => value + point[item.field], 0), 0)}</span>} />
        <ActivityChart points={data.series} />
      </section>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <section className={cn(panelClass, 'p-4 sm:p-5')}>
          <SectionHeading icon={Users} title="Personalstand nach Rang" description={`${data.additional.activeAgents} von ${data.additional.currentAgents} Agents sind aktuell aktiv.`} />
          <div className="space-y-2.5">
            {data.rankDistribution.map((rank) => (
              <div key={rank.id} className="grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)_28px] items-center gap-3">
                <span className="truncate text-[11px] font-medium" style={{ color: rank.color }}>{rank.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[#161616] ring-1 ring-inset ring-white/[0.04]">
                  <span className="block h-full rounded-full" style={{ width: `${(rank.count / rankMax) * 100}%`, backgroundColor: rank.color }} />
                </span>
                <span className="text-right text-[11px] font-semibold text-[#e5e5e5] tabular-nums">{rank.count}</span>
              </div>
            ))}
            {data.rankDistribution.length === 0 && <p className="py-8 text-center text-[12px] italic text-[#686868]">Keine aktiven Agents vorhanden.</p>}
          </div>
        </section>

        <section className={cn(panelClass, 'p-4 sm:p-5')}>
          <SectionHeading icon={BookOpenCheck} title="Ausbildungslage" description={`${data.additional.completedTrainingAssignments} von ${data.additional.trainingAssignments} Zuweisungen abgeschlossen.`} aside={<span className="text-[18px] font-semibold text-[#d4d4d4] tabular-nums">{data.additional.trainingCompletionRate}%</span>} />
          <div className="space-y-3">
            {data.trainingDistribution.slice(0, 8).map((training) => (
              <div key={training.id}>
                <div className="mb-1 flex items-center justify-between gap-3 text-[10.5px]">
                  <span className="truncate text-[#bcbcbc]">{training.label}</span>
                  <span className="shrink-0 text-[#797979] tabular-nums">{training.completed}/{training.total} · {training.percentage}%</span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-[#161616]">
                  <span className="block h-full rounded-full bg-[linear-gradient(90deg,#a98622,#e5c85c)]" style={{ width: `${training.percentage}%` }} />
                </span>
              </div>
            ))}
            {data.trainingDistribution.length === 0 && <p className="py-8 text-center text-[12px] italic text-[#686868]">Keine Ausbildungszuweisungen vorhanden.</p>}
          </div>
        </section>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className={cn(panelClass, 'p-4 sm:p-5 lg:col-span-2')}>
          <SectionHeading icon={BriefcaseBusiness} title="Bewerbungslage" description={`${applicationTotal} Bewerbungen wurden im gewählten Zeitraum eingereicht.`} />
          <div className="grid gap-2 sm:grid-cols-5">
            {data.applicationFunnel.map((item, index) => {
              const colors = ['#38bdf8', '#60a5fa', '#a78bfa', '#34d399', '#f87171']
              return (
                <div key={item.status} className={cn(surfaceClass, 'relative overflow-hidden p-3')}>
                  <span className="absolute inset-x-0 top-0 h-px" style={{ backgroundColor: colors[index] }} />
                  <p className="text-[9.5px] uppercase tracking-[0.1em] text-[#686868]">{item.label}</p>
                  <p className="mt-2 text-[20px] font-semibold text-white tabular-nums">{item.count}</p>
                  <div className="mt-2 h-1 rounded-full bg-[#161616]">
                    <span className="block h-full rounded-full" style={{ width: `${applicationTotal > 0 ? (item.count / applicationTotal) * 100 : 0}%`, backgroundColor: colors[index] }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className={cn(panelClass, 'p-4 sm:p-5')}>
          <SectionHeading icon={ClipboardCheck} title="Weitere Kennzahlen" description="Aktueller Personal- und Verwaltungsstand." />
          <dl className="grid grid-cols-2 gap-2">
            {[
              ['Offene Ausbildungen', data.additional.agentsWithOpenTrainings],
              ['Bewerbungen', data.additional.applications.current],
              ['Neue Probezeiten', data.additional.probationStarts.current],
              ['Neue Ausbildungsarten', data.additional.newTrainingTypes.current],
            ].map(([label, value]) => (
              <div key={String(label)} className={cn(surfaceClass, 'p-3')}>
                <dt className="text-[9.5px] leading-4 text-[#797979]">{label}</dt>
                <dd className="mt-1 text-[18px] font-semibold text-[#e5e5e5] tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className={cn(panelClass, 'mt-3 p-4 sm:p-5')}>
        <SectionHeading
          icon={Trophy}
          title="Bearbeiterbilanz"
          description="Wer hat Einstellungen, Ausbildungen und Personalmaßnahmen im gewählten Zeitraum bearbeitet?"
          aside={(
            <label className="relative block w-full sm:w-[230px]">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#686868]" />
              <input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="PDler suchen…" className="h-8 w-full rounded-[8px] border border-[#404040]/65 bg-[#161616]/75 pl-8 pr-3 text-[11px] text-white outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]/55 focus:ring-2 focus:ring-[#d4d4d4]/12" />
            </label>
          )}
        />

        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <LeaderCard label="Meiste Einstellungen" row={recruiter?.hires ? recruiter : undefined} value={recruiter?.hires ?? 0} icon={UserPlus} />
          <LeaderCard label="Meiste Ausbildungen" row={trainer?.trainingCompletions ? trainer : undefined} value={trainer?.trainingCompletions ?? 0} icon={GraduationCap} />
          <LeaderCard label="Meiste Rangmaßnahmen" row={rankLead && (rankLead.promotions + rankLead.demotions) > 0 ? rankLead : undefined} value={(rankLead?.promotions ?? 0) + (rankLead?.demotions ?? 0)} icon={Sparkles} />
        </div>

        <div className="overflow-x-auto rounded-[11px] border border-white/[0.055]">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead className="bg-[#161616]/90">
              <tr className="text-[9.5px] uppercase tracking-[0.1em] text-[#797979]">
                <th className="px-3 py-2.5 font-semibold">PDler / Bearbeiter</th>
                <th className="px-3 py-2.5 text-center font-semibold">Einstellungen</th>
                <th className="px-3 py-2.5 text-center font-semibold">Ausbildungen</th>
                <th className="px-3 py-2.5 text-center font-semibold">Up-Ranks</th>
                <th className="px-3 py-2.5 text-center font-semibold">D-Ranks</th>
                <th className="px-3 py-2.5 text-center font-semibold">Kündigungen</th>
                <th className="px-3 py-2.5 text-center font-semibold">Sanktionen</th>
                <th className="px-3 py-2.5 text-center font-semibold text-[#d4d4d4]">Gesamt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045] bg-[#1a1a1a]/45">
              {filteredStaff.map((row, index) => (
                <tr key={row.id} className="transition-colors hover:bg-[#282828]/55">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 text-center font-mono text-[9.5px] text-[#656565]">{String(index + 1).padStart(2, '0')}</span>
                      <StaffAvatar row={row} />
                      <span className="max-w-[240px] truncate text-[11.5px] font-medium text-[#e5e5e5]">{row.displayName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#7dd3fc] tabular-nums">{row.hires}</td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#d6d6d6] tabular-nums">{row.trainingCompletions}</td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#6ee7b7] tabular-nums">{row.promotions}</td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#fdba74] tabular-nums">{row.demotions}</td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#fca5a5] tabular-nums">{row.terminations}</td>
                  <td className="px-3 py-2.5 text-center text-[11.5px] text-[#c4b5fd] tabular-nums">{row.sanctions}</td>
                  <td className="px-3 py-2.5 text-center text-[12px] font-semibold text-white tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredStaff.length === 0 && <p className="bg-[#1a1a1a]/45 px-4 py-10 text-center text-[12px] italic text-[#686868]">{staffSearch ? 'Kein Bearbeiter passt zur Suche.' : 'In diesem Zeitraum wurden noch keine Maßnahmen erfasst.'}</p>}
        </div>
        <p className="mt-2.5 text-[10px] leading-4 text-[#656565]">Ausbildungen zählen neu als abgeschlossen markierte Ausbildungszuweisungen. Änderungen ohne neuen Abschluss werden nicht als Leistung gezählt.</p>
      </section>

      <section className={cn(panelClass, 'mt-3 p-4 sm:p-5')}>
        <SectionHeading icon={Activity} title="Neueste Personalbewegungen" description="Die letzten Ereignisse innerhalb des gewählten Zeitraums." />
        <div className="grid gap-2 lg:grid-cols-2">
          {data.latestActivity.map((item) => {
            const meta = activityMeta[item.type]
            const Icon = meta.icon
            return (
              <article key={item.id} className={cn(surfaceClass, 'flex items-center gap-3 p-3')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" style={{ color: meta.color, backgroundColor: meta.bg }}><Icon size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-medium text-[#e5e5e5]">{item.subject}</p>
                  <p className="mt-0.5 truncate text-[10.5px] text-[#868686]">{item.title} · von {item.actor}</p>
                </div>
                <time className="shrink-0 text-[9.5px] text-[#656565]">{formatDateTime(item.createdAt)}</time>
              </article>
            )
          })}
          {data.latestActivity.length === 0 && <p className="py-8 text-center text-[12px] italic text-[#686868] lg:col-span-2">Keine Personalbewegungen im gewählten Zeitraum.</p>}
        </div>
      </section>

      <div className="mt-3 flex items-center justify-between gap-3 px-1 text-[9.5px] text-[#585858]">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={11} /> Datenstand {formatDateTime(data.period.end)}</span>
        <span className="font-mono uppercase tracking-[0.1em]">FIB · Personalstatistik</span>
      </div>
    </div>
  )
}
