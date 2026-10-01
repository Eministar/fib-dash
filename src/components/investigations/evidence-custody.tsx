'use client'

import { displayBadgeNumber } from '@/lib/badge-number'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, FileDown, ShieldAlert, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useFetch } from '@/hooks/use-fetch'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { custodyActionLabel, type CustodyEventDto, type CustodyReport } from '@/lib/custody'
import { cn, formatDateTime } from '@/lib/utils'
import type { AgentLite } from '@/components/investigations/types'

const ACTION_TONE: Record<string, string> = {
  CREATED: 'text-[#30d158]',
  TRANSFERRED: 'text-[#ff9f0a]',
  STATUS_CHANGED: 'text-[#64d2ff]',
  DELETED: 'text-[#ff453a]',
}

export function CustodyIntegrityBadge({ report }: { report: CustodyReport }) {
  return report.integrity.valid ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#30d158]/15 px-2.5 py-1 text-[12px] font-medium text-[#30d158]">
      <ShieldCheck className="h-3.5 w-3.5" />
      Kette lückenlos ({report.events.length} Einträge)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff453a]/15 px-2.5 py-1 text-[12px] font-medium text-[#ff453a]">
      <ShieldAlert className="h-3.5 w-3.5" />
      Kette beschädigt – nachträglich verändert
    </span>
  )
}

/** Eine Zeile der Beweiskette; wird im Dialog und in der Druckansicht genutzt. */
export function CustodyEventRow({ event, broken }: { event: CustodyEventDto; broken: boolean }) {
  return (
    <li className={cn('timeline-entry border-b border-[#2c2c2e] py-2.5 last:border-b-0', broken && 'bg-[#ff453a]/10')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn('text-[13px] font-semibold', ACTION_TONE[event.action] ?? 'text-white')}>
          {custodyActionLabel(event.action)}
        </span>
        <time dateTime={event.createdAt} className="font-mono text-[11.5px] text-[#8e8e93]">
          {formatDateTime(event.createdAt)}
        </time>
      </div>
      <p className="mt-0.5 text-[12.5px] text-[#c7c7cc]">durch {event.actorName}</p>
      {(event.fromHolder || event.toHolder) && (
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#e5e5ea]">
          {event.fromHolder ?? 'unbekannt'}
          <ArrowRight className="h-3.5 w-3.5 text-[#8e8e93]" aria-label="an" />
          {event.toHolder ?? 'unbekannt'}
        </p>
      )}
      {event.location && <p className="mt-0.5 text-[12px] text-[#98989d]">Ort: {event.location}</p>}
      {event.note && <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#98989d]">{event.note}</p>}
      <p className="timeline-print-muted mt-1 font-mono text-[10.5px] text-[#636366]" title={event.hash}>
        #{event.hash.slice(0, 16)}
      </p>
    </li>
  )
}

type TransferForm = { toAgentId: string; toHolder: string; location: string; note: string }
const emptyTransfer = (): TransferForm => ({ toAgentId: '', toHolder: '', location: '', note: '' })

/**
 * Beweiskette eines Asservats: alle Ereignisse, Integritätsprüfung, Übergabe
 * erfassen und Absprung in die Druckansicht (PDF).
 */
export function EvidenceCustodyDialog({
  evidenceId,
  onClose,
  agents,
  canManage,
  onChanged,
}: {
  evidenceId: string | null
  onClose: () => void
  agents: AgentLite[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}) {
  const { data: report, loading, error, refetch } = useFetch<CustodyReport>(
    evidenceId ? `/api/investigations/evidence/${evidenceId}/custody?log=1` : null,
  )
  const { mutate, saving } = useInvestigationMutation(async () => {
    await Promise.all([refetch(), onChanged()])
  })
  const [transferOpen, setTransferOpen] = useState(false)
  const [form, setForm] = useState<TransferForm>(emptyTransfer)

  const close = () => {
    setTransferOpen(false)
    setForm(emptyTransfer())
    onClose()
  }

  const submitTransfer = async () => {
    if (!evidenceId) return
    const ok = await mutate(`/api/investigations/evidence/${evidenceId}/custody`, {
      body: {
        toAgentId: form.toAgentId || null,
        toHolder: form.toAgentId ? null : form.toHolder,
        location: form.location,
        note: form.note,
      },
      successTitle: 'Übergabe erfasst',
      errorTitle: 'Übergabe fehlgeschlagen',
    })
    if (ok) {
      setTransferOpen(false)
      setForm(emptyTransfer())
    }
  }

  const ready = report && report.evidence.id === evidenceId

  return (
    <Modal
      open={evidenceId !== null}
      onClose={close}
      title={ready ? `Beweiskette ${report.evidence.itemNumber}` : 'Beweiskette'}
      description={ready ? report.evidence.title : undefined}
      size="lg"
    >
      {!ready ? (
        <p className="py-10 text-center text-[12.5px] text-[#8e8e93]">{error ?? (loading ? 'Wird geladen …' : '')}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CustodyIntegrityBadge report={report} />
            <Link
              href={`/investigations/evidence/${report.evidence.id}/custody`}
              target="_blank"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-[#c4b5fd] hover:underline"
            >
              <FileDown className="h-3.5 w-3.5" />
              Als PDF exportieren
            </Link>
          </div>

          <dl className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-2">
            <div>
              <dt className="text-[#8e8e93]">Aktueller Verwahrer</dt>
              <dd className="text-white">{report.currentHolder ?? 'keine Übergabe erfasst'}</dd>
            </div>
            <div>
              <dt className="text-[#8e8e93]">Verwahrort</dt>
              <dd className="text-white">{report.evidence.storageLocation ?? '—'}</dd>
            </div>
          </dl>

          {canManage && !transferOpen && (
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
              Übergabe erfassen
            </Button>
          )}

          {canManage && transferOpen && (
            <div className="space-y-3 rounded-[10px] border border-[#38383a] p-3">
              <Select
                label="An Agent"
                options={[
                  { value: '', label: 'Kein Agent – Stelle frei eintragen' },
                  ...agents.map((agent) => ({
                    value: agent.id,
                    label: `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})`,
                  })),
                ]}
                value={form.toAgentId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, toAgentId: value }))}
              />
              {!form.toAgentId && (
                <Input
                  label="An Stelle"
                  value={form.toHolder}
                  onChange={(event) => setForm((prev) => ({ ...prev, toHolder: event.target.value }))}
                  placeholder="z. B. Labor, Staatsanwaltschaft, Asservatenkammer"
                />
              )}
              <Input
                label="Neuer Verwahrort (optional)"
                value={form.location}
                onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              />
              <Textarea
                label="Anlass / Bemerkung"
                value={form.note}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTransferOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  size="sm"
                  onClick={submitTransfer}
                  loading={saving}
                  disabled={!form.toAgentId && !form.toHolder.trim()}
                >
                  Übergabe speichern
                </Button>
              </div>
            </div>
          )}

          <ol className="max-h-[50dvh] overflow-y-auto rounded-[10px] border border-[#2c2c2e] px-3">
            {[...report.events].reverse().map((event) => (
              <CustodyEventRow key={event.id} event={event} broken={event.id === report.integrity.brokenAtId} />
            ))}
          </ol>
          <p className="text-[11.5px] text-[#8e8e93]">
            Einträge lassen sich nicht ändern oder löschen. Jeder Eintrag ist mit seinem Vorgänger verkettet.
          </p>
        </div>
      )}
    </Modal>
  )
}
