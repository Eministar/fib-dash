'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FilePlus2,
  Gavel,
  Layers,
  Loader2,
  Pencil,
  Scale,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { LegalCaseDocument, type LegalCaseDocumentData } from '@/components/legal-affairs/legal-case-document'
import {
  LEGAL_CASE_KIND_META,
  LEGAL_CASE_STATUS_META,
  readLegalCaseSanctions,
  type LegalCaseKindValue,
  type LegalCaseStatusValue,
} from '@/lib/legal-cases'
import { formatFineAmount, penalGradeLabel, sanctionMeasureLabel } from '@/lib/sanction-catalog'
import { displayBadgeNumber } from '@/lib/badge-number'
import { cn, formatDateTime } from '@/lib/utils'

interface CaseRow {
  id: string
  caseNumber: string
  token: string
  kind: LegalCaseKindValue
  status: LegalCaseStatusValue
  title: string
  agentId: string | null
  accusedName: string | null
  accusedBadge: string | null
  accusedRank: string | null
  sanctions: unknown
  createdAt: string
  filedAt: string | null
  closedAt: string | null
}

interface AgentOption {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId: string | null
  status: string
  rankName: string | null
  openSanctionCount: number
}

interface OpenSanction {
  id: string
  reason: string
  penalGrade: string
  measureType: string
  fineAmount: number | null
  sgRounds: number | null
  penalty: string | null
  dueAt: string | null
  createdAt: string
}

const STATUS_FILTERS: { value: '' | LegalCaseStatusValue; label: string }[] = [
  { value: '', label: 'Alle' },
  { value: 'DRAFT', label: 'Entwürfe' },
  { value: 'FILED', label: 'Eingereicht' },
  { value: 'CLOSED', label: 'Geschlossen' },
]

export function LegalCases({ canManage }: { canManage: boolean }) {
  const { addToast } = useToast()
  const { execute, loading: batchLoading } = useApi<{ token: string; caseCount: number }>()
  const { data, loading, refetch } = useFetch<CaseRow[]>('/api/legal-cases')
  const [statusFilter, setStatusFilter] = useState<'' | LegalCaseStatusValue>('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ token: string; caseCount: number } | null>(null)

  const rows = useMemo(() => {
    const list = (data ?? []).filter((row) => !statusFilter || row.status === statusFilter)
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [data, statusFilter])

  const batchUrl = batch ? `${window.location.origin}/klagen/${batch.token}` : ''

  const createBatch = async () => {
    if (!confirm('Für alle gekündigten Mitarbeiter mit offenen Sanktionen werden jetzt Sanktionsklagen erstellt. Fortfahren?')) return
    try {
      const result = await execute('/api/legal-cases/batch', { method: 'POST' })
      if (!result) return
      setBatch(result)
      void refetch()
      addToast({ type: 'success', title: 'Sammelklage erstellt', message: `${result.caseCount} Klagen erzeugt` })
    } catch (e) {
      addToast({ type: 'error', title: 'Sammelklage fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    }
  }

  const copyBatchLink = async () => {
    if (!batchUrl) return
    try {
      await navigator.clipboard.writeText(batchUrl)
      addToast({ type: 'success', title: 'Sammelklage-Link kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Link konnte nicht kopiert werden' })
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                'inline-flex h-8 items-center rounded-[8px] border px-3 text-[12px] font-semibold transition-colors',
                statusFilter === filter.value
                  ? 'border-[#8b5cf6]/40 bg-[#8b5cf6]/12 text-[#c4b5fd]'
                  : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={createBatch} loading={batchLoading}>
              <Layers size={15} />
              Gekündigte mit offenen Sanktionen klagen
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <FilePlus2 size={15} />
              Neue Klage
            </Button>
          </div>
        )}
      </div>

      {batch && (
        <div className="flex flex-col gap-2 rounded-[12px] border border-[#8b5cf6]/35 bg-[#8b5cf6]/8 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white">
              Sammelklage erstellt — {batch.caseCount} Klage{batch.caseCount === 1 ? '' : 'n'}
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-[#a78bfa]">{batchUrl}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(batchUrl, '_blank', 'noopener')}>
              <ExternalLink size={13} /> Übersicht öffnen
            </Button>
            <Button variant="outline" size="sm" onClick={copyBatchLink}>
              <Copy size={13} /> Link kopieren
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="glass-panel-elevated flex flex-col items-center justify-center rounded-[14px] border border-[#373737]/45 px-6 py-16 text-center">
          <div className="mb-3 rounded-full bg-[#8b5cf6]/10 p-4">
            <Scale size={28} className="text-[#a78bfa]" />
          </div>
          <p className="text-[14px] font-semibold text-[#e5e5e5]">Noch keine Klagen</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-[#a6a6a6]">
            Lege eine Sanktionsklage aus einer offenen Sanktion an oder verfasse eine individuelle Klageschrift.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <CaseCard key={row.id} row={row} onOpen={() => setDetailId(row.id)} />
          ))}
        </div>
      )}

      <CreateCaseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          void refetch()
          addToast({ type: 'success', title: 'Klage erstellt' })
        }}
      />

      {detailId && (
        <CaseDetailModal
          caseId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={() => void refetch()}
        />
      )}
    </div>
  )
}

function CaseCard({ row, onOpen }: { row: CaseRow; onOpen: () => void }) {
  const status = LEGAL_CASE_STATUS_META[row.status]
  const kind = LEGAL_CASE_KIND_META[row.kind]
  const sanctionCount = readLegalCaseSanctions(row.sanctions).length

  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-panel-elevated group w-full rounded-[14px] border border-[#373737]/45 p-4 text-left transition-colors hover:border-[#8b5cf6]/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-[6px] bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#a78bfa]">
              {row.caseNumber}
            </span>
            <span className="rounded-full border border-[#343434]/60 bg-[#181818]/60 px-2 py-[1px] text-[10.5px] font-semibold text-[#a6a6a6]">
              {kind.label}
            </span>
          </div>
          <p className="mt-2 truncate text-[14px] font-semibold text-white">{row.title}</p>
          <p className="mt-0.5 truncate text-[12px] text-[#a6a6a6]">
            {row.accusedName ?? 'Ohne Beklagten'}
            {row.accusedBadge ? ` · ${displayBadgeNumber(row.accusedBadge)}` : ''}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-[2px] text-[10.5px] font-semibold', statusClass(row.status))}>
          {status.label}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-[#686868]">
        <span>{formatDateTime(row.createdAt)}</span>
        {sanctionCount > 0 && (
          <>
            <span className="text-[#464646]">·</span>
            <span>{sanctionCount} Sanktion{sanctionCount === 1 ? '' : 'en'}</span>
          </>
        )}
      </div>
    </button>
  )
}

function statusClass(status: LegalCaseStatusValue) {
  if (status === 'FILED') return 'border-[#334e9c]/60 bg-[#171717]/60 text-[#93c5fd]'
  if (status === 'CLOSED') return 'border-[#166534]/60 bg-[#052e1a]/60 text-[#86efac]'
  return 'border-[#727272]/40 bg-[#181818]/50 text-[#a2a2a2]'
}

function CreateCaseModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { execute, loading: submitting } = useApi()
  const [kind, setKind] = useState<LegalCaseKindValue | null>(null)

  const reset = () => {
    setKind(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Neue Klage" size="xl">
      {kind === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setKind('SANCTION')}
            className="rounded-[12px] border border-[#8b5cf6]/35 bg-[#8b5cf6]/8 p-4 text-left transition-colors hover:border-[#8b5cf6]/60 hover:bg-[#8b5cf6]/14"
          >
            <Gavel size={20} className="text-[#a78bfa]" />
            <p className="mt-2 text-[14px] font-semibold text-white">Sanktionsklage</p>
            <p className="mt-1 text-[12px] leading-5 text-[#a6a6a6]">
              {LEGAL_CASE_KIND_META.SANCTION.description}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setKind('CUSTOM')}
            className="rounded-[12px] border border-[#343434]/60 bg-[#181818]/50 p-4 text-left transition-colors hover:border-[#404040] hover:bg-[#1d1d1d]"
          >
            <Scale size={20} className="text-[#a6a6a6]" />
            <p className="mt-2 text-[14px] font-semibold text-white">Individuelle Klageschrift</p>
            <p className="mt-1 text-[12px] leading-5 text-[#a6a6a6]">
              {LEGAL_CASE_KIND_META.CUSTOM.description}
            </p>
          </button>
        </div>
      ) : kind === 'SANCTION' ? (
        <SanctionCaseForm
          submitting={submitting}
          onCreate={async (payload) => {
            await execute('/api/legal-cases', { method: 'POST', body: JSON.stringify({ kind: 'SANCTION', ...payload }) })
            onCreated()
          }}
          onBack={() => setKind(null)}
        />
      ) : (
        <CustomCaseForm
          submitting={submitting}
          onCreate={async (payload) => {
            await execute('/api/legal-cases', { method: 'POST', body: JSON.stringify({ kind: 'CUSTOM', ...payload }) })
            onCreated()
          }}
          onBack={() => setKind(null)}
        />
      )}
    </Modal>
  )
}

function SanctionCaseForm({ submitting, onCreate, onBack }: { submitting: boolean; onCreate: (payload: { agentId: string; sanctionIds: string[] }) => Promise<void>; onBack: () => void }) {
  const { data: agents } = useFetch<AgentOption[]>('/api/legal-cases/agents')
  const [agentId, setAgentId] = useState('')
  const [sanctions, setSanctions] = useState<OpenSanction[]>([])
  const [loadingSanctions, setLoadingSanctions] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const agentOptions = useMemo(() => (agents ?? []).map((agent) => ({
    value: agent.id,
    label: `${agent.firstName} ${agent.lastName}${agent.badgeNumber ? ` (${displayBadgeNumber(agent.badgeNumber)})` : ''}${agent.openSanctionCount > 0 ? ` · ${agent.openSanctionCount} offen` : ''}`,
  })), [agents])

  useEffect(() => {
    if (!agentId) {
      setSanctions([])
      setSelected(new Set())
      return
    }
    let cancelled = false
    setLoadingSanctions(true)
    fetch(`/api/legal-cases/open-sanctions?agentId=${encodeURIComponent(agentId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (cancelled) return
        if (!res.ok || !json.success) throw new Error(json.error || 'Sanktionen konnten nicht geladen werden')
        setSanctions(json.data as OpenSanction[])
      })
      .catch(() => !cancelled && setSanctions([]))
      .finally(() => !cancelled && setLoadingSanctions(false))
    return () => { cancelled = true }
  }, [agentId])

  const totalFine = useMemo(() => sanctions
    .filter((s) => selected.has(s.id) && s.measureType !== 'SG_ROUNDS' && s.fineAmount !== null)
    .reduce((sum, s) => sum + (s.fineAmount ?? 0), 0), [sanctions, selected])

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <Select
        label="Agent auswählen"
        placeholder="Agent wählen…"
        value={agentId}
        onValueChange={setAgentId}
        options={agentOptions}
      />

      {agentId && (
        <div className="rounded-[10px] border border-[#343434]/60 bg-[#181818]/50 p-3">
          {loadingSanctions ? (
            <div className="flex items-center gap-2 py-3 text-[12.5px] text-[#a6a6a6]">
              <Loader2 size={13} className="animate-spin" /> Sanktionen werden geladen…
            </div>
          ) : sanctions.length === 0 ? (
            <p className="py-3 text-[12.5px] text-[#a6a6a6]">
              Dieser Agent hat keine offenen Sanktionen.
            </p>
          ) : (
            <div className="space-y-2">
              {sanctions.map((sanction) => (
                <label
                  key={sanction.id}
                  className="flex cursor-pointer items-start gap-3 rounded-[9px] border border-[#343434]/50 bg-[#0f0f0f]/60 p-3 transition-colors hover:border-[#8b5cf6]/40"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(sanction.id)}
                    onChange={() => toggle(sanction.id)}
                    className="mt-0.5 h-4 w-4 accent-[#8b5cf6]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-[#f4f4f4]">
                      {penalGradeLabel(sanction.penalGrade)} · {sanctionMeasureLabel(sanction)}
                      {sanction.measureType !== 'SG_ROUNDS' && sanction.fineAmount !== null
                        ? ` · ${formatFineAmount(sanction.fineAmount)}`
                        : ''}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-5 text-[#a6a6a6]">{sanction.reason}</span>
                    <span className="mt-0.5 block text-[11px] text-[#808080]">
                      {sanction.dueAt ? `Frist bis ${formatDateTime(sanction.dueAt)}` : 'Ohne Frist'} · {formatDateTime(sanction.createdAt)}
                    </span>
                  </span>
                </label>
              ))}
              {totalFine > 0 && (
                <p className="pt-1 text-[12px] text-[#a78bfa]">
                  Offene Gesamtforderung der Auswahl: {formatFineAmount(totalFine)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>Zurück</Button>
        <Button
          loading={submitting}
          disabled={!agentId || selected.size === 0}
          onClick={() => onCreate({ agentId, sanctionIds: Array.from(selected) })}
        >
          <Gavel size={14} /> Klageschrift erstellen
        </Button>
      </div>
    </div>
  )
}

function CustomCaseForm({ submitting, onCreate, onBack }: { submitting: boolean; onCreate: (payload: { title: string; subject: string; content: string; closing: string | null; agentId: string | null; sanctionIds: string[] }) => Promise<void>; onBack: () => void }) {
  const { data: agents } = useFetch<AgentOption[]>('/api/legal-cases/agents')
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [closing, setClosing] = useState('')
  const [agentId, setAgentId] = useState('')
  const [sanctions, setSanctions] = useState<OpenSanction[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const agentOptions = useMemo(() => [
    { value: '', label: 'Kein Beklagter' },
    ...(agents ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.firstName} ${agent.lastName}${agent.badgeNumber ? ` (${displayBadgeNumber(agent.badgeNumber)})` : ''}`,
    })),
  ], [agents])

  useEffect(() => {
    if (!agentId) {
      setSanctions([])
      setSelected(new Set())
      return
    }
    let cancelled = false
    fetch(`/api/legal-cases/open-sanctions?agentId=${encodeURIComponent(agentId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json()
        if (cancelled || !res.ok || !json.success) return
        setSanctions(json.data as OpenSanction[])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [agentId])

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <Input label="Titel" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Klageschrift" required />
      <Input label="Betreff" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Betreff der Klage…" />
      <Textarea
        label="Sachverhalt (Markdown)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        placeholder={'Die Klägerin erhebt gegen den Beklagten Klage…'}
        required
      />
      <Textarea
        label="Antrag (optional, Markdown)"
        value={closing}
        onChange={(e) => setClosing(e.target.value)}
        rows={4}
        placeholder={'Es wird beantragt, …'}
      />
      <Select label="Beklagter (optional)" value={agentId} onValueChange={setAgentId} options={agentOptions} />

      {sanctions.length > 0 && (
        <div className="rounded-[10px] border border-[#343434]/60 bg-[#181818]/50 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[#a6a6a6]">Offene Sanktionen als Beweis</p>
          <div className="space-y-2">
            {sanctions.map((sanction) => (
              <label key={sanction.id} className="flex cursor-pointer items-start gap-3 rounded-[9px] border border-[#343434]/50 bg-[#0f0f0f]/60 p-3">
                <input type="checkbox" checked={selected.has(sanction.id)} onChange={() => toggle(sanction.id)} className="mt-0.5 h-4 w-4 accent-[#8b5cf6]" />
                <span className="text-[12.5px] text-[#f4f4f4]">
                  {penalGradeLabel(sanction.penalGrade)} · {sanctionMeasureLabel(sanction)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>Zurück</Button>
        <Button
          loading={submitting}
          disabled={!title.trim() || !content.trim()}
          onClick={() => onCreate({
            title: title.trim(),
            subject: subject.trim(),
            content: content.trim(),
            closing: closing.trim() || null,
            agentId: agentId || null,
            sanctionIds: Array.from(selected),
          })}
        >
          <FilePlus2 size={14} /> Klageschrift erstellen
        </Button>
      </div>
    </div>
  )
}

function CaseDetailModal({ caseId, canManage, onClose, onChanged }: { caseId: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { execute, loading: busy } = useApi<LegalCaseDocumentData>()
  const { addToast } = useToast()
  const [doc, setDoc] = useState<LegalCaseDocumentData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ title: '', subject: '', content: '', closing: '' })

  const load = useCallback(async () => {
    setState('loading')
    try {
      const json = await execute(`/api/legal-cases/${encodeURIComponent(caseId)}`)
      if (json) {
        setDoc(json)
        setForm({ title: json.title, subject: json.subject, content: json.content, closing: json.closing ?? '' })
        setState('ready')
      } else {
        setState('error')
      }
    } catch {
      setState('error')
    }
  }, [caseId, execute])

  useEffect(() => { void load() }, [load])

  const copyLink = async () => {
    if (!doc) return
    const url = `${window.location.origin}/klage/${doc.token}`
    try {
      await navigator.clipboard.writeText(url)
      addToast({ type: 'success', title: 'Link kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Link konnte nicht kopiert werden' })
    }
  }

  const openLink = () => {
    if (doc) window.open(`${window.location.origin}/klage/${doc.token}`, '_blank', 'noopener')
  }

  const changeStatus = async (status: LegalCaseStatusValue) => {
    try {
      await execute(`/api/legal-cases/${encodeURIComponent(caseId)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await load()
      onChanged()
      addToast({ type: 'success', title: 'Status aktualisiert' })
    } catch (e) {
      addToast({ type: 'error', title: 'Status konnte nicht geändert werden', message: e instanceof Error ? e.message : '' })
    }
  }

  const saveEdits = async () => {
    try {
      await execute(`/api/legal-cases/${encodeURIComponent(caseId)}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      setEditing(false)
      await load()
      onChanged()
      addToast({ type: 'success', title: 'Klage gespeichert' })
    } catch (e) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    }
  }

  const remove = async () => {
    if (!doc || !confirm(`Klage ${doc.caseNumber} wirklich löschen?`)) return
    try {
      await execute(`/api/legal-cases/${encodeURIComponent(caseId)}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Klage gelöscht' })
      onChanged()
      onClose()
    } catch (e) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    }
  }

  return (
    <Modal open onClose={onClose} title={doc ? doc.title : 'Klageschrift'} size="xl">
      {state === 'loading' && (
        <div className="flex items-center gap-2 py-10 text-[13px] text-[#a6a6a6]">
          <Loader2 size={14} className="animate-spin" /> Klageschrift wird geladen…
        </div>
      )}
      {state === 'error' && <p className="py-10 text-[13px] text-[#fca5a5]">Klageschrift konnte nicht geladen werden.</p>}

      {state === 'ready' && doc && (
        <div className="space-y-4">
          {!editing && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={openLink}>
                <ExternalLink size={13} /> Link öffnen
              </Button>
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy size={13} /> Link kopieren
              </Button>
              {canManage && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                    <Pencil size={13} /> Bearbeiten
                  </Button>
                  {doc.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => changeStatus('FILED')} loading={busy}>
                      <CheckCircle2 size={13} /> Einreichen
                    </Button>
                  )}
                  {doc.status === 'FILED' && (
                    <Button size="sm" onClick={() => changeStatus('CLOSED')} loading={busy}>
                      <CheckCircle2 size={13} /> Schließen
                    </Button>
                  )}
                  {doc.status === 'CLOSED' && (
                    <Button variant="secondary" size="sm" onClick={() => changeStatus('DRAFT')} loading={busy}>
                      Wieder öffnen
                    </Button>
                  )}
                  <Button variant="danger" size="sm" onClick={remove}>
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
            </div>
          )}

          {editing ? (
            <div className="space-y-3">
              <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <Input label="Betreff" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              <Textarea label="Sachverhalt (Markdown)" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={10} />
              <Textarea label="Antrag (Markdown)" value={form.closing} onChange={(e) => setForm({ ...form, closing: e.target.value })} rows={5} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                  <X size={13} /> Abbrechen
                </Button>
                <Button size="sm" onClick={saveEdits} loading={busy} disabled={!form.title.trim() || !form.content.trim()}>
                  Speichern
                </Button>
              </div>
            </div>
          ) : (
            <LegalCaseDocument document={doc} />
          )}

          {!editing && (
            <p className="break-all font-mono text-[10.5px] leading-4 text-[#686868]">
              {window.location.origin}/klage/{doc.token}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
