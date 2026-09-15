'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, Printer, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { AgreementDocument, type AgreementDocumentData } from '@/components/agreements/agreement-document'

interface LinkPayload {
  party: { name: string; role: string | null; signedAt: string | null; signedName: string | null; declinedAt: string | null }
  canSign: boolean
  agreement: AgreementDocumentData
}

type State = { kind: 'loading' } | { kind: 'ready'; data: LinkPayload } | { kind: 'error'; message: string }

export default function AgreementSigningPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = Array.isArray(params.token) ? params.token[0] : params.token ?? ''
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agreement-links/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) setState({ kind: 'error', message: 'Dieser Link ist ungültig.' })
      else setState({ kind: 'ready', data: json.data })
    } catch {
      setState({ kind: 'error', message: 'Verbindung zum Server fehlgeschlagen.' })
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true)
    setFormError(null)
    try {
      const res = await fetch(`/api/agreement-links/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || !json.success) setFormError(json.error || 'Aktion fehlgeschlagen.')
      else setState({ kind: 'ready', data: json.data })
    } catch {
      setFormError('Verbindung zum Server fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') return <div className="flex min-h-screen items-center justify-center"><PdCloudLoader /></div>
  if (state.kind === 'error') {
    return (
      <main className="mx-auto max-w-xl px-5 py-20 text-center">
        <ShieldX className="mx-auto text-[#808080]" size={28} />
        <h1 className="mt-3 text-xl font-semibold text-white">Link ungültig</h1>
        <p className="mt-2 text-sm text-[#a6a6a6]">{state.message}</p>
      </main>
    )
  }

  const { party, canSign, agreement } = state.data
  const notice =
    agreement.status === 'DRAFT' ? 'Dieser Vertrag ist noch nicht freigegeben.'
    : agreement.status === 'CANCELLED' ? 'Dieser Vertrag wurde zurückgezogen.'
    : party.signedAt ? `Du hast am ${new Date(party.signedAt).toLocaleString('de-DE')} unterschrieben.`
    : party.declinedAt ? 'Du hast diesen Vertrag abgelehnt.'
    : agreement.status === 'DECLINED' ? 'Eine andere Partei hat diesen Vertrag abgelehnt.'
    : agreement.status === 'SIGNED' ? 'Alle Parteien haben unterschrieben.'
    : null

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-[#a6a6a6]">
          Du unterschreibst für: <span className="font-semibold text-white">{party.name}</span>
          {party.role ? ` · ${party.role}` : ''}
        </p>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer size={14} /> Drucken / PDF
        </Button>
      </div>

      {notice && (
        <p className="flex items-center gap-2 rounded-[10px] border border-[#343434] bg-[#181818] px-4 py-3 text-sm text-[#d4d4d4] print:hidden">
          <CheckCircle2 size={16} className="text-[#a6a6a6]" /> {notice}
        </p>
      )}

      <AgreementDocument document={agreement} />

      {canSign && (
        <section className="space-y-4 rounded-[14px] border border-[#343434] bg-[#141414] p-5 print:hidden">
          <label className="block text-sm text-[#d4d4d4]">
            Vollständiger Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder="Vor- und Nachname"
              className="mt-1.5 h-10 w-full rounded-[8px] border border-[#343434] bg-[#181818] px-3 text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Ich habe den Vertrag vollständig gelesen und stimme zu.
          </label>
          <p className="text-xs text-[#c08a5a]">Dieser Link ist persönlich. Wer ihn besitzt, kann für deine Partei unterschreiben.</p>
          {formError && <p role="alert" className="text-sm text-red-300">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={name.trim().length < 3 || !confirmed} onClick={() => submit({ action: 'sign', name, confirmed })}>
              Unterschreiben
            </Button>
            <Button variant="ghost" onClick={() => setShowDecline((open) => !open)}>Ablehnen</Button>
          </div>
          {showDecline && (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Grund (optional)"
                className="w-full rounded-[8px] border border-[#343434] bg-[#181818] px-3 py-2 text-white"
              />
              <Button variant="danger" loading={busy} onClick={() => submit({ action: 'decline', reason })}>Vertrag ablehnen</Button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
