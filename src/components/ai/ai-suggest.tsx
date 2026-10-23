'use client'

import { useState } from 'react'
import { Check, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import type { AiSuggestion, AiSuggestionKind } from '@/lib/ai/ai-prompts'

type Status = { enabled: boolean; configured: boolean }

/**
 * KI-Knopf für Formulare: Stichwörter eingeben, Vorschlag prüfen, dann
 * übernehmen oder verwerfen. Erscheint nur, wenn der Assistent eingeschaltet ist.
 * Übernehmen füllt das Formular – gespeichert wird weiterhin erst beim Speichern.
 */
export function AiSuggest({ kind, investigationId, dossierId, onAccept }: {
  kind: AiSuggestionKind
  investigationId?: string | null
  dossierId?: string | null
  onAccept: (suggestion: AiSuggestion) => void
}) {
  const status = useFetch<Status>('/api/ai/status')
  const { execute, loading } = useApi<AiSuggestion>()
  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState('')
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null)
  const [failure, setFailure] = useState('')

  if (!status.data?.enabled) return null

  const generate = async () => {
    setFailure('')
    try {
      const result = await execute('/api/ai/suggest', {
        method: 'POST',
        body: JSON.stringify({ kind, keywords, investigationId: investigationId ?? null, dossierId: dossierId ?? null }),
      })
      if (result) setSuggestion(result)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Kein Vorschlag möglich')
    }
  }

  const close = () => { setOpen(false); setSuggestion(null); setFailure('') }

  if (!open) {
    return <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
      <Sparkles size={14} aria-hidden /> Mit KI formulieren
    </Button>
  }

  return <section aria-label="KI-Assistent" className="rounded-[12px] border border-[#a78bfa]/30 bg-[#161225]/50 p-3.5">
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#ddd6fe]"><Sparkles size={14} aria-hidden /> KI-Assistent</p>
      <button type="button" onClick={close} aria-label="KI-Assistent schließen" className="rounded p-1 text-[#98989d] hover:bg-[#2c2c2e] hover:text-white"><X size={14} /></button>
    </div>

    {!suggestion ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void generate() }}>
      <Input
        label="Stichwörter"
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        maxLength={500}
        placeholder="z. B. Hafen, zwei schwarze SUVs, Übergabe beobachtet, Kennzeichen notiert"
        autoFocus
      />
      <p className="text-[11.5px] leading-relaxed text-[#98989d]">
        Die KI formuliert nur aus deinen Stichwörtern und den Daten der Akte. Sie erfindet nichts dazu, was fehlt, lässt sie weg.
      </p>
      {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={loading} disabled={!keywords.trim()}><Sparkles size={13} aria-hidden /> Vorschlag erstellen</Button>
      </div>
    </form> : <div className="space-y-3" aria-live="polite">
      <div className="rounded-[10px] border border-[#38383a] bg-[#0b0b0b]/60 p-3">
        <p className="text-[13.5px] font-medium text-white">{suggestion.title}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[#d4d4d4]">{suggestion.content}</p>
      </div>
      {suggestion.missing.length > 0 && <div className="text-[12px] text-[#fbbf24]">
        <p>Fehlt noch (nicht erfunden, bitte selbst ergänzen):</p>
        <ul className="mt-1 list-disc pl-5 text-[#fde68a]">{suggestion.missing.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>}
      {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={close}><X size={13} aria-hidden /> Verwerfen</Button>
        <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => void generate()}><RefreshCw size={13} aria-hidden /> Neu erzeugen</Button>
        <Button type="button" size="sm" onClick={() => { onAccept(suggestion); close() }}><Check size={13} aria-hidden /> Übernehmen</Button>
      </div>
    </div>}
  </section>
}
