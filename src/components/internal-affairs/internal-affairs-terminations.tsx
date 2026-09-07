'use client'

import { useMemo, useState } from 'react'
import { RefreshCw, Search, UserX } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/hooks/use-fetch'
import { displayBadgeNumber } from '@/lib/badge-number'
import { cn, formatDateTime } from '@/lib/utils'

type TerminationEntry = {
  id: string
  reason: string
  terminatedAt: string
  previousRank: string | null
  previousBadgeNumber: string | null
  previousFirstName: string | null
  previousLastName: string | null
  agent: {
    id: string
    firstName: string
    lastName: string
    badgeNumber: string
    status: string
    rank: { name: string; color: string }
  } | null
  terminatedBy: { displayName: string } | null
}

function agentName(entry: TerminationEntry) {
  return [
    entry.agent?.firstName ?? entry.previousFirstName,
    entry.agent?.lastName ?? entry.previousLastName,
  ].filter(Boolean).join(' ') || 'Unbekannte Person'
}

function caseId(id: string) {
  const suffix = id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()
  return suffix ? `ENT-${suffix}` : '—'
}

export function InternalAffairsTerminations() {
  const { data: terminations, loading, error, refetch } = useFetch<TerminationEntry[]>('/api/terminations')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de-DE')
    if (!needle) return terminations ?? []
    return (terminations ?? []).filter((entry) => [
      agentName(entry),
      entry.previousBadgeNumber ?? entry.agent?.badgeNumber ?? '',
      entry.previousRank ?? entry.agent?.rank.name ?? '',
      entry.reason,
      caseId(entry.id),
    ].join(' ').toLocaleLowerCase('de-DE').includes(needle))
  }, [terminations, query])

  if (loading && !terminations) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="IA · Personalakten"
        title="Liste der Entlassungen"
        description={`${terminations?.length ?? 0} dokumentierte Entlassungen mit Rang, Grund und erfassender Person`}
        action={(
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            <RefreshCw size={13} /> Aktualisieren
          </Button>
        )}
      />

      {error && (
        <div className="rounded-xl border border-[#fb7185]/25 bg-[#fb7185]/[0.06] px-4 py-3 text-[12px] text-[#fda4af]">
          {error}
        </div>
      )}

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6d6d6d]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, Dienstnummer, Rang oder Fall-ID suchen"
          className="h-9 w-full rounded-[9px] border border-[#343434]/75 bg-[#1b1b1b]/75 pl-9 pr-3 text-[12.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#656565] focus:border-[#0ea5e9]/55 focus:ring-2 focus:ring-[#0ea5e9]/10"
        />
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[#343434]/75 bg-[#161616]/45">
        {filtered.length > 0 ? (
          <div className="divide-y divide-[#343434]/55">
            {filtered.map((entry) => {
              const displayName = agentName(entry)
              const badgeNumber = displayBadgeNumber(entry.previousBadgeNumber ?? entry.agent?.badgeNumber ?? null)
              const stillTerminated = !entry.agent || entry.agent.status === 'TERMINATED'
              return (
                <article key={entry.id} className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-[#fb7185]/20 bg-[#fb7185]/[0.07] text-[#fda4af]">
                    <UserX size={17} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-[13.5px] font-semibold text-[#f4f4f4]">{displayName}</h3>
                      <span className="font-mono text-[10.5px] text-[#7dd3fc]">DN: {badgeNumber}</span>
                      <span className={cn(
                        'rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]',
                        stillTerminated
                          ? 'border-[#fb7185]/20 bg-[#fb7185]/[0.07] text-[#fda4af]'
                          : 'border-[#34d399]/20 bg-[#34d399]/[0.07] text-[#6ee7b7]',
                      )}>
                        {stillTerminated ? 'Entlassen' : 'Wiedereingestellt'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px] text-[#b4b4b4]">
                      Alter Rang: <span className="font-medium text-[#e5e5e5]">{entry.previousRank ?? entry.agent?.rank.name ?? '—'}</span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-5 text-[#d3d3d3]">{entry.reason}</p>
                    <p className="mt-2 text-[10.5px] text-[#767676]">
                      {formatDateTime(entry.terminatedAt)} · eingetragen von {entry.terminatedBy?.displayName ?? 'Gelöschter Benutzer'}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-[10px] border border-[#343434]/55 bg-[#181818]/55 px-3 py-2 sm:min-w-[112px] sm:text-right">
                    <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#6d6d6d]">Fall-ID</p>
                    <p className="mt-1 font-mono text-[11px] font-semibold text-[#d4d4d4]">{caseId(entry.id)}</p>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-16 text-center">
            <UserX size={27} className="mx-auto mb-3 text-[#595959]" strokeWidth={1.5} />
            <p className="text-[13px] text-[#a6a6a6]">
              {terminations && terminations.length > 0 ? 'Keine Treffer für die Suche' : 'Noch keine Entlassungen dokumentiert'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
