'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, MapPin, Search } from 'lucide-react'

import { ListSkeleton } from '@/components/ui/loading'
import { TabBar } from '@/components/ui/tab-bar'
import { LspdOfficerFileView } from '@/components/lspd/lspd-officer-file'
import { useFetch } from '@/hooks/use-fetch'
import type { LspdOfficerFile } from '@/lib/lspd-officers'
import type { QcOfficerStats } from '@/lib/quality-checks'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { AverageGrade, BalanceChips, GradeBadge, QcEntryList, RatingBadge, type QcEntry } from './qc-shared'

type Overview = { title: string; scope: string; expiresAt: string | null; officers: QcOfficerStats[] }
type SharedCheck = {
  id: string
  number: string
  officerName: string
  officerBadge: string
  officerRank: string
  status: string
  rating: string | null
  grade: number | null
  startedAt: string
  endedAt: string | null
  location: string | null
  summary: string | null
  entries: QcEntry[]
}
type OfficerDetail = { lspdOfficerId: string; career: LspdOfficerFile | null; checks: SharedCheck[] }

type SortKey = 'recent' | 'name' | 'grade'
const SORT_LABELS: Record<SortKey, string> = { recent: 'Letzte Kontrolle', name: 'Name', grade: 'Ø Note' }

/** Öffentliche Leseansicht eines Freigabelinks – ohne Login, ohne Prüfernamen. */
export function QualitySharedView({ token }: { token: string }) {
  const base = `/api/shared-quality/${encodeURIComponent(token)}`
  const { data, error, loading } = useFetch<Overview>(base)
  const [selected, setSelected] = useState<string | null>(null)

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-5 py-20">
        <h1 className="text-xl font-semibold text-white">Freigabe nicht verfügbar</h1>
        <p className="mt-3 text-sm text-[#98989d]">Der Link ist ungültig, deaktiviert, abgelaufen oder momentan nicht erreichbar.</p>
      </main>
    )
  }
  if (loading || !data) return <ListSkeleton compact />

  // Eine einzelne Kontrolle oder Akte braucht kein Register.
  const hasRegister = data.scope === 'ALL' || data.officers.length > 1
  const officerId = selected ?? (hasRegister ? null : data.officers[0]?.lspdOfficerId ?? null)
  const officer = data.officers.find((item) => item.lspdOfficerId === officerId)
  const checkCount = data.officers.reduce((sum, item) => sum + item.total, 0)

  const open = (id: string | null) => {
    setSelected(id)
    window.scrollTo({ top: 0 })
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <header className="mb-6 border-b border-[#38383a] pb-5">
        <p className="mb-2 text-xs uppercase tracking-wider text-[#8e8e93]">FIB · Qualitätskontrollen</p>
        <h1 className="text-2xl font-semibold text-white">{data.title}</h1>
        <p className="mt-2 text-sm text-[#98989d]">
          Leseansicht · {data.officers.length} {data.officers.length === 1 ? 'Akte' : 'Akten'} · {checkCount}{' '}
          {checkCount === 1 ? 'Kontrolle' : 'Kontrollen'}
          {data.expiresAt ? ` · Gültig bis ${new Date(data.expiresAt).toLocaleString('de-DE')}` : ''}
        </p>
      </header>

      {officerId ? (
        <>
          {hasRegister && (
            <button type="button" onClick={() => open(null)} className="mb-5 text-sm text-[#c4b5fd] hover:underline">
              ← Zum Akten-Register
            </button>
          )}
          <SharedOfficer key={officerId} url={`${base}/officers/${encodeURIComponent(officerId)}`} stats={officer} />
        </>
      ) : (
        <Register officers={data.officers} onOpen={open} />
      )}
    </main>
  )
}

/** Akten-Register: ein Beamter pro Zeile, durchsuch- und sortierbar. */
function Register({ officers, onOpen }: { officers: QcOfficerStats[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [onlyRunning, setOnlyRunning] = useState(false)

  const query = search.trim().toLowerCase()
  const rows = officers
    .filter((officer) => `${officer.name} ${officer.badgeNumber} ${officer.rank}`.toLowerCase().includes(query))
    .filter((officer) => !onlyRunning || officer.running > 0)
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'de')
      // Ohne Note ans Ende.
      if (sort === 'grade') return (a.gradeAverage ?? 99) - (b.gradeAverage ?? 99)
      return b.lastCheckAt.localeCompare(a.lastCheckAt)
    })

  return (
    <section aria-label="Akten-Register">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e93]" aria-hidden />
          <input
            aria-label="Akten durchsuchen"
            placeholder="Name, Dienstnummer oder Rang …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-[38px] w-full rounded-[9px] border border-[#38383a] bg-[#1c1c1e] pl-9 pr-3 text-sm text-white placeholder:text-[#8e8e93]"
          />
        </label>
        <select
          aria-label="Sortierung"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="h-[38px] rounded-[9px] border border-[#38383a] bg-[#1c1c1e] px-3 text-sm text-white"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>Sortieren: {SORT_LABELS[key]}</option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={onlyRunning}
          onClick={() => setOnlyRunning((value) => !value)}
          className={cn(
            'h-[38px] rounded-[9px] border px-3 text-sm',
            onlyRunning ? 'border-[#64d2ff]/60 bg-[#0a84ff]/15 text-[#64d2ff]' : 'border-[#38383a] text-[#98989d] hover:text-white',
          )}
        >
          Nur mit laufender Kontrolle
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#38383a] bg-[#161617]">
        <div className="hidden grid-cols-[minmax(0,1fr)_110px_90px_150px_110px_20px] gap-4 border-b border-[#38383a] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#8e8e93] sm:grid">
          <span>Beamter</span>
          <span>Kontrollen</span>
          <span>Ø Note</span>
          <span>Bewertungen</span>
          <span>Zuletzt</span>
          <span />
        </div>
        <ul className="divide-y divide-[#2c2c2e]">
          {rows.map((officer) => (
            <li key={officer.lspdOfficerId}>
              <button
                type="button"
                onClick={() => onOpen(officer.lspdOfficerId)}
                className="grid w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left hover:bg-[#1c1c1e] sm:grid-cols-[minmax(0,1fr)_110px_90px_150px_110px_20px]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white">{officer.name}</span>
                  <span className="block truncate text-xs text-[#98989d]">
                    <span className="font-mono text-[#c4b5fd]">DN {officer.badgeNumber}</span> · {officer.rank}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-[#636366] sm:order-last" aria-hidden />
                <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:contents">
                  <span className="text-[#e5e5ea]">
                    {officer.total}
                    <span className="text-[#8e8e93] sm:hidden"> Kontrollen</span>
                    {officer.running > 0 && <span className="ml-1.5 text-[#64d2ff]">({officer.running} läuft)</span>}
                  </span>
                  <span className="font-mono">
                    <span className="text-[#8e8e93] sm:hidden">Ø </span>
                    <AverageGrade value={officer.gradeAverage} />
                  </span>
                  <span className="flex gap-2.5 font-mono">
                    <span className="text-[#30d158]" title="positiv">{officer.ratings.POSITIVE}↑</span>
                    <span className="text-[#d4d4d4]" title="neutral">{officer.ratings.NEUTRAL}→</span>
                    <span className="text-[#ff453a]" title="negativ">{officer.ratings.NEGATIVE}↓</span>
                  </span>
                  <span className="text-[#98989d]">{formatDate(officer.lastCheckAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!rows.length && <p className="px-5 py-8 text-sm text-[#8e8e93]">Keine Akten gefunden.</p>}
      </div>
    </section>
  )
}

function SharedOfficer({ url, stats }: { url: string; stats?: QcOfficerStats }) {
  const { data, error, loading } = useFetch<OfficerDetail>(url)
  const [tab, setTab] = useState('checks')
  const [expanded, setExpanded] = useState<Set<string> | null>(null)

  if (error) return <p role="alert" className="text-sm text-[#98989d]">Diese Akte ist nicht mehr freigegeben.</p>
  if (loading || !data) return <ListSkeleton compact />

  const first = data.checks[0]
  // Eine einzelne Kontrolle direkt aufgeklappt zeigen.
  const openIds = expanded ?? new Set(data.checks.length === 1 ? [first.id] : [])
  const toggle = (id: string) => {
    const next = new Set(openIds)
    if (!next.delete(id)) next.add(id)
    setExpanded(next)
  }
  const allOpen = data.checks.length > 0 && openIds.size === data.checks.length

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">{stats?.name ?? first?.officerName}</h2>
          <p className="mt-1 text-sm text-[#98989d]">
            <span className="font-mono text-[#c4b5fd]">DN {stats?.badgeNumber ?? first?.officerBadge}</span> · {stats?.rank ?? first?.officerRank}
          </p>
        </div>
        {stats && (
          <dl className="flex gap-6 text-sm">
            <Fact label="Kontrollen" value={`${stats.total}${stats.running ? ` (${stats.running} läuft)` : ''}`} />
            <Fact label="Ø Note" value={<AverageGrade value={stats.gradeAverage} />} />
            <Fact
              label="Bewertungen"
              value={
                <span className="flex gap-2.5 font-mono">
                  <span className="text-[#30d158]">{stats.ratings.POSITIVE}↑</span>
                  <span className="text-[#d4d4d4]">{stats.ratings.NEUTRAL}→</span>
                  <span className="text-[#ff453a]">{stats.ratings.NEGATIVE}↓</span>
                </span>
              }
            />
          </dl>
        )}
      </div>

      <TabBar
        label="Akte"
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: 'checks', label: 'Kontrollen', count: data.checks.length },
          ...(data.career ? [{ id: 'career', label: 'LSPD-Laufbahn' }] : []),
        ]}
      />

      {tab === 'career' && data.career ? (
        <LspdOfficerFileView file={data.career} />
      ) : (
        <>
          {data.checks.length > 1 && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setExpanded(new Set(allOpen ? [] : data.checks.map((check) => check.id)))}
                className="text-xs text-[#c4b5fd] hover:underline"
              >
                {allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}
              </button>
            </div>
          )}
          <ul className="overflow-hidden rounded-xl border border-[#38383a] bg-[#161617] divide-y divide-[#2c2c2e]">
            {data.checks.map((check) => (
              <CheckRow key={check.id} check={check} open={openIds.has(check.id)} onToggle={() => toggle(check.id)} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[#8e8e93]">{label}</dt>
      <dd className="mt-0.5 text-[#e5e5ea]">{value}</dd>
    </div>
  )
}

function CheckRow({ check, open, onToggle }: { check: SharedCheck; open: boolean; onToggle: () => void }) {
  const panelId = `check-${check.id}`
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left hover:bg-[#1c1c1e]"
      >
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#8e8e93] transition-transform', !open && '-rotate-90')} aria-hidden />
        <span className="w-[64px] shrink-0 font-mono text-xs text-[#d4af37]">{check.number}</span>
        <span className="min-w-0 flex-1 text-sm text-white">
          {formatDateTime(check.startedAt)}
          {check.endedAt ? ` – ${formatDateTime(check.endedAt)}` : ''}
          {check.location && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-[#98989d]">
              <MapPin className="h-3 w-3" aria-hidden />
              {check.location}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <BalanceChips entries={check.entries} />
          <GradeBadge grade={check.grade} />
          <RatingBadge rating={check.rating} />
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t border-[#2c2c2e] bg-[#111112] px-5 py-4">
          {check.summary && (
            <div className="mb-4">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-[#8e8e93]">Fazit</p>
              <p className="whitespace-pre-wrap text-sm text-[#e5e5ea]">{check.summary}</p>
            </div>
          )}
          <QcEntryList entries={check.entries} showAuthors={false} />
        </div>
      )}
    </li>
  )
}
