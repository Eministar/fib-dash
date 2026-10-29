'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldAlert, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import type { LinkedCorruptionCheck } from '@/components/investigations/types'

interface Props {
  investigationId: string
  checks: LinkedCorruptionCheck[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

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

function CheckLabel({ check }: { check: LinkedCorruptionCheck }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[#8e8e93]" />
        <span className="text-[13px] text-white">
          {check.official.firstName} {check.official.lastName}
        </span>
        <span className="text-[11.5px] text-[#8e8e93]">{check.official.agency}</span>
        <ResultBadge result={check.result} />
      </div>
      <p className="mt-0.5 text-[12px] text-[#98989d]">
        {dateFormat.format(new Date(check.conductedAt))}
        {check.location ? ` · ${check.location}` : ''}
      </p>
    </>
  )
}

/// Korruptionskontrollen, die zu dieser Einsatzakte gehören.
export function InvestigationCorruptionChecks({ investigationId, checks, canManage, onChanged }: Props) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const { data, loading } = useFetch<{ items: LinkedCorruptionCheck[] }>(
    open && canManage ? `/api/corruption-checks?${new URLSearchParams({ search: query })}` : null,
  )
  const taken = new Set(checks.map((check) => check.id))
  const candidates = (data?.items ?? []).filter((check) => !taken.has(check.id))
  const url = `/api/investigations/${investigationId}/corruption-checks`

  const link = async (checkId: string) => {
    if (await mutate(url, { body: { checkId }, successTitle: 'Korruptionskontrolle verknüpft', errorTitle: 'Verknüpfen fehlgeschlagen' })) {
      setOpen(false)
      setSearch('')
    }
  }

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-white">Korruptionskontrollen ({checks.length})</h2>
          <p className="mt-0.5 text-[11.5px] text-[#8e8e93]">Kontrollen von Staatsbeamten, die zu diesem Einsatz gehören.</p>
        </div>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <ShieldAlert className="h-3.5 w-3.5" />
            Kontrolle anknüpfen
          </Button>
        )}
      </div>

      {checks.length === 0 ? (
        <p className="py-3 text-[12.5px] text-[#8e8e93]">Keine Korruptionskontrolle verknüpft.</p>
      ) : (
        <ul className="space-y-2">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start justify-between gap-3">
              <Link
                href={`/corruption-checks?official=${check.official.id}`}
                className="min-w-0 flex-1 rounded-[9px] border border-[#2c2c2e] bg-[#161617] p-2.5 transition-colors hover:border-[#48484a]"
              >
                <CheckLabel check={check} />
              </Link>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void mutate(url, { method: 'DELETE', body: { checkId: check.id }, successTitle: 'Verknüpfung gelöst', errorTitle: 'Lösen fehlgeschlagen' })}
                  className="mt-2 shrink-0 text-[#8e8e93] transition-colors hover:text-[#fca5a5]"
                  aria-label="Korruptionskontrolle lösen"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Korruptionskontrolle anknüpfen" description="Suche nach Beamtem, Behörde, Ort oder Befund." size="lg">
        <div className="space-y-3">
          <Input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="z. B. Nachname oder Dienstnummer" />
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {candidates.map((check) => (
              <li key={check.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void link(check.id)}
                  className="w-full rounded-[9px] border border-[#2c2c2e] bg-[#161617] p-2.5 text-left transition-colors hover:border-[#a78bfa] disabled:opacity-50"
                >
                  <CheckLabel check={check} />
                </button>
              </li>
            ))}
          </ul>
          {!loading && candidates.length === 0 && <p className="py-2 text-[12.5px] text-[#8e8e93]">Keine passende Kontrolle gefunden.</p>}
        </div>
      </Modal>
    </Card>
  )
}
