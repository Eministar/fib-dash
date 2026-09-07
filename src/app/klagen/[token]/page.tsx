'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Gavel, Printer, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { formatFineAmount, penalGradeLabel, sanctionMeasureLabel } from '@/lib/sanction-catalog'
import { formatDateTime } from '@/lib/utils'

interface BatchCase {
  id: string
  caseNumber: string
  token: string
  kind: string
  status: string
  title: string
  accusedName: string | null
  accusedBadge: string | null
  accusedRank: string | null
  sanctions: {
    sanctionId: string
    reason: string
    penalGrade: string
    measureType: string
    fineAmount: number | null
    sgRounds: number | null
    dueAt: string | null
    createdAt: string
  }[]
}

interface BatchPayload {
  token: string
  title: string
  createdAt: string
  caseCount: number
  cases: BatchCase[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; batch: BatchPayload }
  | { kind: 'error'; status: number; message: string }

function paramToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function LegalCaseBatchPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = paramToken(params.token)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'error', status: 404, message: 'Dieser Sammelklage-Link ist unvollständig.' })
      return
    }
    try {
      const res = await fetch(`/api/legal-case-batches/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setState({ kind: 'error', status: res.status, message: json.error || 'Sammelklage konnte nicht geladen werden.' })
        return
      }
      setState({ kind: 'ready', batch: json.data as BatchPayload })
    } catch {
      setState({ kind: 'error', status: 0, message: 'Verbindung zum Server fehlgeschlagen.' })
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  if (state.kind === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-[#a6a6a6]">
          <PdCloudLoader />
          <p className="text-[13px]">Sammelklage wird geladen…</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <Notice title={state.status === 404 ? 'Sammelklage nicht gefunden' : 'Sammelklage nicht verfügbar'} description={state.message}>
          <Button variant="secondary" onClick={() => void load()}>Erneut versuchen</Button>
        </Notice>
      </Shell>
    )
  }

  const batch = state.batch

  return (
    <Shell>
      <div className="contract-no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]">
            Federal Investigation Bureau · Legal Affairs Division
          </p>
          <h1 className="mt-1 text-[22px] font-semibold text-white">{batch.title}</h1>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
            {batch.caseCount} Klage{batch.caseCount === 1 ? '' : 'n'} · erstellt am {formatDateTime(batch.createdAt)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Drucken
        </Button>
      </div>

      {batch.cases.length === 0 ? (
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 px-6 py-16 text-center">
          <Scale size={28} className="mx-auto mb-3 text-[#8b5cf6]" />
          <p className="text-[13px] text-[#a6a6a6]">Diese Sammelklage enthält keine Klageschriften.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {batch.cases.map((legalCase, index) => (
            <div
              key={legalCase.id}
              className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-[#a78bfa]">
                      {legalCase.caseNumber}
                    </span>
                    <span className="rounded-full border border-[#343434]/60 bg-[#181818]/60 px-2 py-[1px] text-[10.5px] font-semibold text-[#a6a6a6]">
                      {index + 1}. Klage
                    </span>
                  </div>
                  <p className="mt-1.5 text-[15px] font-semibold text-white">
                    {legalCase.accusedName ?? 'Ohne Beklagten'}
                  </p>
                  <p className="text-[12px] text-[#a6a6a6]">
                    {[legalCase.accusedBadge ? `DN ${legalCase.accusedBadge}` : null, legalCase.accusedRank].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <Link href={`/klage/${legalCase.token}`} className="shrink-0">
                  <Button size="sm">
                    <Gavel size={13} /> Klageschrift <ArrowRight size={13} />
                  </Button>
                </Link>
              </div>

              {legalCase.sanctions.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-[#343434]/50 pt-3">
                  {legalCase.sanctions.map((sanction) => (
                    <div key={sanction.sanctionId} className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-[#a6a6a6]">
                      <span className="font-semibold text-[#c4b5fd]">{penalGradeLabel(sanction.penalGrade)}</span>
                      <span>{sanctionMeasureLabel(sanction)}</span>
                      {sanction.measureType !== 'SG_ROUNDS' && sanction.fineAmount !== null && (
                        <span className="text-[#d4d4d4]">{formatFineAmount(sanction.fineAmount)}</span>
                      )}
                      <span className="text-[#686868]">· {sanction.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#080808] px-3 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-[840px]">{children}</div>
    </main>
  )
}

function Notice({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/12 text-[#d4d4d4]">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-[19px] font-semibold text-white">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-[#a6a6a6]">{description}</p>
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </section>
  )
}
