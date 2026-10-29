'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFetch } from '@/hooks/use-fetch'
import type { LinkedCorruptionCheck } from '@/components/investigations/types'

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

export function corruptionCheckTitle(check: LinkedCorruptionCheck) {
  return `${check.official.firstName} ${check.official.lastName} (${check.official.agency})`
}

function ResultBadge({ result }: { result: string }) {
  const findings = result === 'FINDINGS'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ${
        findings ? 'bg-[#3b1d1d] text-[#fca5a5]' : 'bg-[#16301f] text-[#86efac]'
      }`}
    >
      {findings ? 'Befund' : 'Ohne Befund'}
    </span>
  )
}

function CheckSummary({ check }: { check: LinkedCorruptionCheck }) {
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-white">{corruptionCheckTitle(check)}</span>
        <ResultBadge result={check.result} />
      </span>
      <span className="mt-0.5 block text-[12px] text-[#98989d]">
        Kontrolle am {dateFormat.format(new Date(check.conductedAt))}
        {check.location ? ` · ${check.location}` : ''}
      </span>
    </span>
  )
}

/// Hinweis im Aktenkopf: Die Akte geht aus dieser Korruptionskontrolle hervor.
export function CorruptionReason({ check }: { check: LinkedCorruptionCheck }) {
  return (
    <Link
      href={`/corruption-checks?official=${check.official.id}`}
      className="mt-4 flex items-start gap-3 rounded-[10px] border border-[#3a2a2a] bg-[#1d1414] p-3 transition-colors hover:border-[#5a3a3a]"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#fca5a5]" />
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-[#8e8e93]">Anlass · Korruptionskontrolle</span>
        <CheckSummary check={check} />
      </span>
    </Link>
  )
}

/// Wahl der Korruptionskontrolle, die Hauptgrund der Akte ist (optional).
export function CorruptionCheckSelect({
  value,
  onChange,
}: {
  value: LinkedCorruptionCheck | null
  onChange: (check: LinkedCorruptionCheck | null) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const open = choosing || !value
  const { data, loading } = useFetch<{ items: LinkedCorruptionCheck[] }>(
    open ? `/api/corruption-checks?${new URLSearchParams({ search: query })}` : null,
  )
  const candidates = (data?.items ?? []).filter((check) => check.id !== value?.id).slice(0, 8)

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[12.5px] font-medium text-[#98989d]">Anlass: Korruptionskontrolle</p>
        <p className="text-[11.5px] text-[#8e8e93]">Optional. Wähle die Kontrolle, aus der diese Ermittlung hervorgeht.</p>
      </div>

      {value && (
        <div className="flex items-start justify-between gap-3 rounded-[9px] border border-[#3a2a2a] bg-[#1d1414] p-2.5">
          <CheckSummary check={value} />
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={() => setChoosing((previous) => !previous)}>
              {choosing ? 'Abbrechen' : 'Ändern'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setChoosing(false); onChange(null) }}>
              Entfernen
            </Button>
          </div>
        </div>
      )}

      {open && (
        <>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Beamter, Behörde, Ort oder Befund suchen"
            aria-label="Korruptionskontrolle suchen"
          />
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {candidates.map((check) => (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={() => { setChoosing(false); setSearch(''); onChange(check) }}
                  className="w-full rounded-[9px] border border-[#2c2c2e] bg-[#161617] p-2.5 text-left transition-colors hover:border-[#a78bfa]"
                >
                  <CheckSummary check={check} />
                </button>
              </li>
            ))}
          </ul>
          {!loading && candidates.length === 0 && (
            <p className="text-[12px] text-[#8e8e93]">Keine passende Korruptionskontrolle gefunden.</p>
          )}
        </>
      )}
    </div>
  )
}
