'use client'

import { useState } from 'react'
import { BadgeCheck, Ban, Clock, History, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { ListSkeleton } from '@/components/ui/loading'

type LicenseState = 'NONE' | 'GRANTED' | 'REVOKED'

interface LicenseRow {
  license: { id: string; key: string; label: string; description: string | null; cooldownDays: number }
  state: LicenseState
  regainableAt: string | null
  since: string | null
}

interface HistoryEntry {
  id: string
  licenseLabel: string
  action: 'GRANTED' | 'REVOKED'
  reason: string | null
  regainableAt: string | null
  overrodeCooldown: boolean
  bulk: boolean
  sanction: { id: string; label: string } | null
  actorName: string | null
  createdAt: string
}

interface AgentLicenses {
  licenses: LicenseRow[]
  history: HistoryEntry[]
  sanctions: { id: string; label: string }[]
}

type Dialog = { row: LicenseRow; action: 'grant' | 'revoke' }

/** Sperrfrist läuft noch? Dann darf nur bewusst übersteuert erteilt werden. */
function blocked(row: LicenseRow) {
  return row.state === 'REVOKED' && !!row.regainableAt && new Date(row.regainableAt) > new Date()
}

function stateBadge(row: LicenseRow) {
  if (row.state === 'GRANTED') return { label: 'Erteilt', className: 'bg-[#4ade80]/10 text-[#4ade80]' }
  if (row.state === 'REVOKED') {
    return blocked(row)
      ? { label: `Entzogen · wieder ab ${formatDate(row.regainableAt!)}`, className: 'bg-[#f87171]/10 text-[#f87171]' }
      : { label: 'Entzogen · wieder erteilbar', className: 'bg-[#fbbf24]/10 text-[#fbbf24]' }
  }
  return { label: 'Nicht erteilt', className: 'bg-[#8e8e93]/10 text-[#8e8e93]' }
}

/**
 * Interne Lizenzen eines Agents (Konzept „Lizenzen Intern“): Stand je Lizenz,
 * Erteilen und Entziehen mit Begründung, dazu die Historie.
 */
export function AgentLicensesPanel({ agentId, canManage, terminated }: { agentId: string; canManage: boolean; terminated: boolean }) {
  const url = `/api/agents/${agentId}/licenses`
  const { data, setData, error, refetch } = useFetch<AgentLicenses>(url)
  const { execute, loading } = useApi<AgentLicenses>()
  const { addToast } = useToast()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [form, setForm] = useState({ reason: '', sanctionId: '', overrideCooldown: false })
  const [showHistory, setShowHistory] = useState(false)
  const manage = canManage && !terminated

  const open = (row: LicenseRow, action: Dialog['action']) => {
    setForm({ reason: '', sanctionId: '', overrideCooldown: false })
    setDialog({ row, action })
  }

  const submit = async () => {
    if (!dialog) return
    try {
      const next = await execute(url, {
        method: 'POST',
        body: JSON.stringify({ licenseId: dialog.row.license.id, action: dialog.action, ...form }),
      })
      if (next) setData(next)
      addToast({ type: 'success', title: dialog.action === 'grant' ? 'Lizenz erteilt' : 'Lizenz entzogen' })
      setDialog(null)
    } catch (cause) {
      addToast({ type: 'error', title: 'Fehler', message: cause instanceof Error ? cause.message : '' })
    }
  }

  if (!data) {
    return (
      <div className="border-b border-[#38383a]/60 py-4">
        {error
          ? <div className="space-y-2"><p role="alert" className="text-[13px] text-[#f87171]">{error}</p><Button size="sm" variant="outline" onClick={refetch}>Erneut versuchen</Button></div>
          : <ListSkeleton rows={4} compact />}
      </div>
    )
  }

  const granted = data.licenses.filter((row) => row.state === 'GRANTED').length
  const dialogBlocked = dialog ? blocked(dialog.row) : false
  const reasonRequired = dialog?.action === 'revoke' || (dialogBlocked && form.overrideCooldown)
  const canSubmit = dialog
    && (!reasonRequired || form.reason.trim().length >= 3)
    && (dialog.action === 'revoke' || !dialogBlocked || form.overrideCooldown)

  return (
    <div className="border-b border-[#38383a]/60 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-[#eee]">Lizenzen</h3>
          <p className="mt-0.5 text-[12px] text-[#8e8e93]">{granted} von {data.licenses.length} erteilt{terminated ? ' · ausgeschieden, nur lesbar' : ''}</p>
        </div>
        {data.history.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setShowHistory((value) => !value)}>
            <History size={13} strokeWidth={1.85} /> {showHistory ? 'Historie ausblenden' : `Historie (${data.history.length})`}
          </Button>
        )}
      </div>

      {data.licenses.length === 0 ? (
        <p className="text-[12.5px] text-[#8e8e93]">Noch keine Lizenzarten angelegt.</p>
      ) : (
        <div className="divide-y divide-[#38383a]/60 rounded-[10px] border border-[#38383a]/60">
          {data.licenses.map((row) => {
            const badge = stateBadge(row)
            return (
              <div key={row.license.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#eee]">{row.license.label}</p>
                  {row.license.description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[#8e8e93]" title={row.license.description}>{row.license.description}</p>}
                </div>
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium', badge.className)}>
                  {row.state === 'REVOKED' && blocked(row) && <Clock size={11} strokeWidth={2} />}
                  {badge.label}
                </span>
                {manage && (
                  row.state === 'GRANTED'
                    ? <Button size="sm" variant="secondary" onClick={() => open(row, 'revoke')}><ShieldOff size={13} strokeWidth={1.85} /> Entziehen</Button>
                    : <Button size="sm" variant="secondary" onClick={() => open(row, 'grant')}><BadgeCheck size={13} strokeWidth={1.85} /> Erteilen</Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showHistory && (
        <div className="mt-3 space-y-2">
          {data.history.map((entry) => {
            const granted = entry.action === 'GRANTED'
            return (
              <div key={entry.id} className="rounded-[8px] bg-[#2c2c2e] p-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-[#eee]">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', granted ? 'bg-[#4ade80]' : 'bg-[#f87171]')} aria-hidden />
                  {entry.licenseLabel} {granted ? 'erteilt' : 'entzogen'}
                  {entry.overrodeCooldown && <span className="ml-2 text-[11.5px] font-normal text-[#fbbf24]">Sperrfrist übersteuert</span>}
                  {entry.bulk && <span className="ml-2 text-[11.5px] font-normal text-[#8e8e93]">Erstausstattung</span>}
                </p>
                {entry.reason && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#8e8e93]">{entry.reason}</p>}
                {entry.sanction && <p className="mt-0.5 text-[12px] text-[#8e8e93]">Sanktion: {entry.sanction.label}</p>}
                {entry.regainableAt && <p className="mt-0.5 text-[12px] text-[#8e8e93]">Wieder möglich ab {formatDate(entry.regainableAt)}</p>}
                <p className="mt-1.5 text-[11px] text-[#8e8e93]">{formatDateTime(entry.createdAt)} · {entry.actorName ?? 'Gelöscht'}</p>
              </div>
            )
          })}
        </div>
      )}

      {manage && dialog && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title={`${dialog.row.license.label} ${dialog.action === 'grant' ? 'erteilen' : 'entziehen'}`}
        >
          <div className="space-y-4">
            {dialog.action === 'revoke' ? (
              <>
                <p className="text-[12.5px] leading-relaxed text-[#8e8e93]">
                  {dialog.row.license.cooldownDays > 0
                    ? `Die Lizenz kann frühestens in ${dialog.row.license.cooldownDays} Tagen wieder erteilt werden.`
                    : 'Für diese Lizenz gibt es keine Sperrfrist – sie kann nach erneuter Ausbildung/Prüfung jederzeit wieder erteilt werden.'}
                </p>
                <Textarea label="Grund" value={form.reason} rows={3} maxLength={2000} required
                  placeholder="z. B. Beschwerde wegen Fahrverhalten im Einsatz am …"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                {data.sanctions.length > 0 && (
                  <Select
                    label="Zugehörige Sanktion (optional)"
                    value={form.sanctionId}
                    onValueChange={(sanctionId) => setForm({ ...form, sanctionId })}
                    options={[{ value: '', label: 'Keine Sanktion' }, ...data.sanctions.map((sanction) => ({ value: sanction.id, label: sanction.label }))]}
                  />
                )}
              </>
            ) : (
              <>
                {dialogBlocked && (
                  <div className="flex gap-2.5 rounded-[8px] bg-[#f87171]/10 p-3 text-[12.5px] leading-relaxed text-[#f87171]">
                    <Ban size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                    <span>Die Sperrfrist läuft noch bis {formatDate(dialog.row.regainableAt!)}. Erteilen nur mit Begründung, warum nicht bis dahin gewartet wird.</span>
                  </div>
                )}
                {dialogBlocked && (
                  <label className="flex items-center gap-2 text-[13px] text-[#eee]">
                    <input type="checkbox" checked={form.overrideCooldown} onChange={(e) => setForm({ ...form, overrideCooldown: e.target.checked })} />
                    Sperrfrist bewusst übersteuern
                  </label>
                )}
                <Textarea label={reasonRequired ? 'Begründung' : 'Notiz (optional)'} value={form.reason} rows={3} maxLength={2000}
                  placeholder="z. B. Fahrt mit der Academy bestanden"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDialog(null)}>Abbrechen</Button>
              <Button size="sm" loading={loading} disabled={!canSubmit} variant={dialog.action === 'revoke' ? 'danger' : undefined} onClick={submit}>
                {dialog.action === 'grant' ? 'Erteilen' : 'Entziehen'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
