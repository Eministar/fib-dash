'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { LegalCaseDocument, type LegalCaseDocumentData } from '@/components/legal-affairs/legal-case-document'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; document: LegalCaseDocumentData }
  | { kind: 'error'; status: number; message: string }

function paramToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function LegalCaseSharePage() {
  const params = useParams<{ token: string | string[] }>()
  const token = paramToken(params.token)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'error', status: 404, message: 'Dieser Klageschrift-Link ist unvollständig.' })
      return
    }
    try {
      const res = await fetch(`/api/legal-case-links/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setState({ kind: 'error', status: res.status, message: json.error || 'Klageschrift konnte nicht geladen werden.' })
        return
      }
      setState({ kind: 'ready', document: json.data as LegalCaseDocumentData })
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
          <p className="text-[13px]">Klageschrift wird geladen…</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <Notice
          title={state.status === 404 ? 'Klageschrift nicht gefunden' : 'Klageschrift nicht verfügbar'}
          description={state.message}
        >
          <Button variant="secondary" onClick={() => void load()}>Erneut versuchen</Button>
        </Notice>
      </Shell>
    )
  }

  const document = state.document

  return (
    <Shell>
      <div className="contract-no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]">
            Federal Investigation Bureau
          </p>
          <h1 className="mt-1 text-[20px] font-semibold text-white">{document.title}</h1>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
            Aktenzeichen {document.caseNumber} · {document.status === 'FILED' ? 'Eingereicht' : document.status === 'CLOSED' ? 'Geschlossen' : 'Entwurf'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Drucken / als PDF speichern
        </Button>
      </div>

      <LegalCaseDocument document={document} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#080808] px-3 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-[880px]">{children}</div>
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
