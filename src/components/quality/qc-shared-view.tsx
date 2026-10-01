'use client'

import { useState } from 'react'

import { ListSkeleton } from '@/components/ui/loading'
import { LspdOfficerFileView } from '@/components/lspd/lspd-officer-file'
import { useFetch } from '@/hooks/use-fetch'
import type { LspdOfficerFile } from '@/lib/lspd-officers'
import type { QcOfficerStats } from '@/lib/quality-checks'
import { formatDate, formatDateTime } from '@/lib/utils'
import { BalanceChips, GradeBadge, QcEntryList, RatingBadge, type QcEntry } from './qc-shared'

type Overview = { title: string; scope: string; expiresAt: string | null; officers: QcOfficerStats[] }
type OfficerDetail = {
  lspdOfficerId: string
  career: LspdOfficerFile | null
  checks: {
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
  }[]
}

/** Öffentliche Leseansicht eines Freigabelinks – ohne Login, ohne Prüfernamen. */
export function QualitySharedView({ token }: { token: string }) {
  const base = `/api/shared-quality/${encodeURIComponent(token)}`
  const { data, error, loading } = useFetch<Overview>(base)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-5 py-20">
        <h1 className="text-xl font-semibold text-white">Freigabe nicht verfügbar</h1>
        <p className="mt-3 text-sm text-[#98989d]">Der Link ist ungültig, deaktiviert, abgelaufen oder momentan nicht erreichbar.</p>
      </main>
    )
  }
  if (loading || !data) return <ListSkeleton compact />

  // Bei nur einem Beamten direkt dessen Akte zeigen.
  const officerId = selected ?? (data.officers.length === 1 ? data.officers[0].lspdOfficerId : null)
  const officers = data.officers.filter((officer) =>
    `${officer.name} ${officer.badgeNumber}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <header className="mb-7 border-b border-[#38383a] pb-5">
        <p className="mb-2 text-xs uppercase tracking-wider text-[#8e8e93]">FIB · Qualitätskontrollen</p>
        <h1 className="text-2xl font-semibold text-white">{data.title}</h1>
        <p className="mt-2 text-sm text-[#98989d]">
          Leseansicht · {data.officers.length} {data.officers.length === 1 ? 'Beamter' : 'Beamte'}
          {data.expiresAt ? ` · Gültig bis ${new Date(data.expiresAt).toLocaleString('de-DE')}` : ''}
        </p>
      </header>

      {officerId ? (
        <>
          {data.officers.length > 1 && (
            <button type="button" onClick={() => setSelected(null)} className="mb-5 text-sm text-[#c4b5fd] hover:underline">
              ← Zur Übersicht
            </button>
          )}
          <SharedOfficer key={officerId} url={`${base}/officers/${encodeURIComponent(officerId)}`} />
        </>
      ) : (
        <>
          <input
            aria-label="Beamte durchsuchen"
            placeholder="Beamte suchen …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-[38px] w-full rounded-[9px] border border-[#38383a] bg-[#1c1c1e] px-3 text-sm text-white placeholder:text-[#8e8e93]"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {officers.map((officer) => (
              <button
                key={officer.lspdOfficerId}
                type="button"
                onClick={() => setSelected(officer.lspdOfficerId)}
                className="rounded-xl border border-[#38383a] bg-[#161617] p-5 text-left hover:border-[#a78bfa]"
              >
                <p className="font-mono text-xs text-[#c4b5fd]">DN {officer.badgeNumber}</p>
                <h2 className="mt-1 font-semibold text-white">{officer.name}</h2>
                <p className="mt-1 text-xs text-[#98989d]">
                  {officer.rank} · {officer.total} Kontrollen{officer.running ? ` (${officer.running} laufend)` : ''} · zuletzt {formatDate(officer.lastCheckAt)}
                </p>
                <p className="mt-2 flex gap-3 font-mono text-xs">
                  <span className="text-[#30d158]">{officer.ratings.POSITIVE} positiv</span>
                  <span className="text-[#d4d4d4]">{officer.ratings.NEUTRAL} neutral</span>
                  <span className="text-[#ff453a]">{officer.ratings.NEGATIVE} negativ</span>
                </p>
              </button>
            ))}
          </div>
          {!officers.length && <p className="py-8 text-sm text-[#8e8e93]">Keine Beamten gefunden.</p>}
        </>
      )}
    </main>
  )
}

function SharedOfficer({ url }: { url: string }) {
  const { data, error, loading } = useFetch<OfficerDetail>(url)
  if (error) return <p role="alert" className="text-sm text-[#98989d]">Diese Akte ist nicht mehr freigegeben.</p>
  if (loading || !data) return <ListSkeleton compact />
  const first = data.checks[0]

  return (
    <div className="space-y-5">
      {data.career ? (
        <LspdOfficerFileView file={data.career} />
      ) : (
        <div>
          <h2 className="text-xl font-semibold text-white">{first?.officerName}</h2>
          <p className="text-sm text-[#98989d]">DN {first?.officerBadge} · {first?.officerRank}</p>
        </div>
      )}
      {data.checks.map((check) => (
        <article key={check.id} className="rounded-xl border border-[#38383a] bg-[#161617] p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-xs text-[#d4af37]">{check.number}</p>
              <p className="mt-1 text-sm text-white">
                {formatDateTime(check.startedAt)}
                {check.endedAt ? ` – ${formatDateTime(check.endedAt)}` : ''}
                {check.location ? ` · ${check.location}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <BalanceChips entries={check.entries} />
              <GradeBadge grade={check.grade} long />
              <RatingBadge rating={check.rating} />
            </div>
          </div>
          {check.summary && <p className="mt-3 whitespace-pre-wrap text-sm text-[#e5e5ea]">{check.summary}</p>}
          <div className="mt-4">
            <QcEntryList entries={check.entries} showAuthors={false} />
          </div>
        </article>
      ))}
    </div>
  )
}
