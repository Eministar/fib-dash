'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { MAX_REPORT_LENGTH } from '@/lib/ai/ai-prompts'
import type { Charge } from '@/lib/investigations/charges'

type Status = { enabled: boolean }
type Result = { created: number; charges: Charge[]; missing: string[] }

/** Knopf in der Chronologie – nur sichtbar, wenn der KI-Assistent an ist. */
export function AiEntriesButton({ onClick }: { onClick: () => void }) {
  const status = useFetch<Status>('/api/ai/status')
  if (!status.data?.enabled) return null
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      Mit KI eintragen
    </Button>
  )
}

/**
 * Bericht einfügen → die KI legt daraus direkt Chronologie-Einträge an und
 * ergänzt erkannte Straftatbestände. Kein Zwischenschritt: Einträge lassen
 * sich danach normal bearbeiten oder löschen.
 */
export function AiEntriesDialog({ investigationId, onClose, onDone }: {
  investigationId: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { execute, loading } = useApi<Result>()
  const [report, setReport] = useState('')
  const [failure, setFailure] = useState('')

  const submit = async () => {
    setFailure('')
    try {
      const result = await execute(`/api/investigations/${investigationId}/ai-entries`, { method: 'POST', body: JSON.stringify({ report }) })
      if (!result) return
      const parts = [`${result.created} ${result.created === 1 ? 'Eintrag' : 'Einträge'} angelegt`]
      if (result.charges.length) parts.push(`Straftatbestände ergänzt: ${result.charges.map((charge) => charge.label).join(', ')}`)
      if (result.missing.length) parts.push(`Fehlt noch: ${result.missing.join(', ')}`)
      onDone(parts.join(' · '))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Die KI konnte keine Einträge anlegen.')
    }
  }

  return (
    <Modal open onClose={loading ? () => {} : onClose} title="Mit KI in die Chronologie" description="Bericht oder Stichwörter einfügen – die KI teilt sie in Einträge auf und trägt sie direkt in die Akte ein." size="lg">
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Textarea
          label="Bericht / Stichwörter"
          value={report}
          onChange={(event) => setReport(event.target.value)}
          rows={9}
          maxLength={MAX_REPORT_LENGTH}
          placeholder={'z. B.\n20 uhr observation lagerhalle elysian, 3 personen mit kisten\nzugriff 21 uhr, diego vasquez festgenommen, 2 pistolen sichergestellt\nvernehmung: sagt aus rosa liefert die ware'}
          autoFocus
        />
        <p className="text-[11.5px] leading-relaxed text-[#98989d]">
          Die KI formuliert nur, was im Bericht steht, und erfindet nichts dazu. Straftatbestände kommen aus dem Gesetzbuch des FJD und werden nur ergänzt, wenn der Bericht sie eindeutig beschreibt.
        </p>
        {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] tabular-nums text-[#6e6e73]">{report.length} / {MAX_REPORT_LENGTH}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Abbrechen</Button>
            <Button type="submit" loading={loading} disabled={!report.trim()}><Sparkles size={13} aria-hidden /> Einträge anlegen</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
