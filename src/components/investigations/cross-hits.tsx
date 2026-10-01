'use client'

import Link from 'next/link'
import { Link2, SearchCheck } from 'lucide-react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFetch } from '@/hooks/use-fetch'
import type { CaseRef, CrossHit } from '@/lib/cross-hits'

function hitHref(hit: CrossHit) {
  return hit.kind === 'person'
    ? `/investigations/persons?person=${hit.id}`
    : `/investigations/vehicles?vehicle=${hit.id}`
}

/**
 * Hinweis im Anlegen-Formular: „Diese Person ist schon erfasst – in 2
 * Ermittlungen“. `query` ist der Suchteil der URL (ohne `?`); `null` blendet
 * den Hinweis aus.
 */
export function CrossHitHint({ query }: { query: string | null }) {
  const debounced = useDebouncedValue(query, 400)
  const { data } = useFetch<CrossHit[]>(debounced ? `/api/investigations/cross-hits?${debounced}` : null)
  const hits = query && debounced === query ? data ?? [] : []
  if (hits.length === 0) return null

  return (
    <div role="status" className="rounded-[10px] border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-3">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[#fcd34d]">
        <SearchCheck className="h-4 w-4" />
        Bereits erfasst
      </p>
      <ul className="mt-2 space-y-2">
        {hits.map((hit) => (
          <li key={hit.id} className="text-[12.5px] text-[#e5e5ea]">
            <Link href={hitHref(hit)} target="_blank" className="font-medium text-white hover:underline">
              {hit.name}
            </Link>{' '}
            <span className="font-mono text-[11px] text-[#98989d]">{hit.code}</span>
            <span className="text-[#98989d]"> · Treffer über {hit.matchedOn.join(', ')}</span>
            <span className="block text-[12px] text-[#c7c7cc]">
              {hit.investigations.length === 0 ? (
                'In keiner (für dich sichtbaren) Ermittlung.'
              ) : (
                <>
                  Taucht in {hit.investigations.length === 1 ? '1 Ermittlung' : `${hit.investigations.length} Ermittlungen`} auf:{' '}
                  <CaseLinks cases={hit.investigations} />
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-[#98989d]">
        Prüfe, ob du die bestehende Akte verknüpfen statt eine doppelte anlegen willst.
      </p>
    </div>
  )
}

function CaseLinks({ cases, max = 4 }: { cases: CaseRef[]; max?: number }) {
  const shown = cases.slice(0, max)
  return (
    <>
      {shown.map((item, index) => (
        <span key={item.id}>
          {index > 0 && ', '}
          <Link href={`/investigations/${item.id}`} title={item.title} className="font-mono text-[#c4b5fd] hover:underline">
            {item.caseNumber}
          </Link>
        </span>
      ))}
      {cases.length > max && <span className="text-[#98989d]"> und {cases.length - max} weitere</span>}
    </>
  )
}

/** Zeile unter einer beteiligten Person / einem Fahrzeug: „Auch in 2 weiteren Akten: …“ */
export function OtherCasesNote({ cases }: { cases: CaseRef[] | undefined }) {
  if (!cases || cases.length === 0) return null
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-[#fcd34d]">
      <Link2 className="h-3 w-3" />
      Auch in {cases.length === 1 ? '1 weiteren Akte' : `${cases.length} weiteren Akten`}:{' '}
      <CaseLinks cases={cases} max={3} />
    </p>
  )
}

/** Suchteil der URL für eine Person; `null`, wenn nichts Brauchbares eingegeben ist. */
export function personCrossHitQuery(form: {
  firstName: string
  lastName: string
  alias: string
  identifier: string
  phone: string
}, excludePersonId?: string | null) {
  const params = new URLSearchParams()
  for (const key of ['firstName', 'lastName', 'alias', 'identifier', 'phone'] as const) {
    const value = form[key].trim()
    if (value) params.set(key, value)
  }
  if (params.size === 0) return null
  if (excludePersonId) params.set('excludePersonId', excludePersonId)
  return params.toString()
}

export function vehicleCrossHitQuery(plate: string, excludeVehicleId?: string | null) {
  const trimmed = plate.trim()
  if (trimmed.replace(/[^a-z0-9]/gi, '').length < 3) return null
  const params = new URLSearchParams({ plate: trimmed })
  if (excludeVehicleId) params.set('excludeVehicleId', excludeVehicleId)
  return params.toString()
}
