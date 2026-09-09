'use client'

import { useMemo, useState } from 'react'
import {
  ExternalLink,
  Eye,
  FileEdit,
  Link2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'

import { PENAL_GRADE_ORDER, PENAL_GRADE_RULES } from '@/lib/sanction-catalog'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { PageLoader } from '@/components/ui/loading'
import { Select, type SelectOption } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { displayBadgeNumber } from '@/lib/badge-number'
import { formatDateTime } from '@/lib/utils'

export interface DawEvidence {
  url: string
  title?: string | null
  description?: string | null
}

export interface InternalAffairsDawItem {
  id: string
  caseNumber: string | null
  title: string
  category: string
  agentId: string | null
  agent: {
    id: string
    firstName: string
    lastName: string
    badgeNumber: string
    status: string
    avatarUrl?: string | null
    rank: { id: string; name: string; color: string }
  } | null
  allegation: string | null
  statement: string | null
  penalGrade: string | null
  sanctionSummary: string | null
  fineAmount: number | null
  sgRounds: number | null
  suspensionHours: number | null
  status: string
  evidence: DawEvidence[] | null
  incidentAt: string | null
  deadlineAt: string | null
  resolutionNote: string | null
  createdBy: { id: string; displayName: string } | null
  previousFirstName: string | null
  previousLastName: string | null
  previousBadgeNumber: string | null
  previousRank: string | null
  createdAt: string
  updatedAt: string
}

interface AgentSelectOption {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank: { id: string; name: string; color: string }
  avatarUrl?: string | null
}

const CATEGORY_META: Record<string, { label: string; badgeVariant: 'warning' | 'danger' | 'info' | 'default' }> = {
  DAW: { label: 'Dienstaufsichtswarnung (DAW)', badgeVariant: 'warning' },
  DISCIPLINARY: { label: 'Disziplinarverfahren', badgeVariant: 'danger' },
  INSTRUCTION: { label: 'Dienstanweisung', badgeVariant: 'info' },
  INVESTIGATION: { label: 'Interne Ermittlung', badgeVariant: 'default' },
  OTHER: { label: 'Sonstige IA-Akte', badgeVariant: 'default' },
}

const STATUS_META: Record<string, { label: string; badgeVariant: 'warning' | 'info' | 'danger' | 'success' | 'default' }> = {
  OPEN: { label: 'In Ermittlung', badgeVariant: 'warning' },
  IN_REVIEW: { label: 'In Prüfung', badgeVariant: 'info' },
  SANCTIONED: { label: 'Sanktion verhängt', badgeVariant: 'danger' },
  RESOLVED: { label: 'Abgeschlossen', badgeVariant: 'success' },
  DISMISSED: { label: 'Eingestellt / Abgelehnt', badgeVariant: 'default' },
}

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'ALL', label: 'Alle Kategorien' },
  { value: 'DAW', label: 'DAW (Warnung)' },
  { value: 'DISCIPLINARY', label: 'Disziplinarverfahren' },
  { value: 'INSTRUCTION', label: 'Dienstanweisung' },
  { value: 'INVESTIGATION', label: 'Interne Ermittlung' },
  { value: 'OTHER', label: 'Sonstige Akte' },
]

const FORM_CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'DAW', label: 'Dienstaufsichtswarnung (DAW)' },
  { value: 'DISCIPLINARY', label: 'Disziplinarverfahren' },
  { value: 'INSTRUCTION', label: 'Dienstanweisung' },
  { value: 'INVESTIGATION', label: 'Interne Ermittlung' },
  { value: 'OTHER', label: 'Sonstige IA-Akte' },
]

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'ALL', label: 'Alle Status' },
  { value: 'OPEN', label: 'In Ermittlung' },
  { value: 'IN_REVIEW', label: 'In Prüfung' },
  { value: 'SANCTIONED', label: 'Sanktion verhängt' },
  { value: 'RESOLVED', label: 'Abgeschlossen' },
  { value: 'DISMISSED', label: 'Eingestellt / Abgelehnt' },
]

const FORM_STATUS_OPTIONS: SelectOption[] = [
  { value: 'OPEN', label: 'In Ermittlung' },
  { value: 'IN_REVIEW', label: 'In Prüfung' },
  { value: 'SANCTIONED', label: 'Sanktion verhängt' },
  { value: 'RESOLVED', label: 'Abgeschlossen' },
  { value: 'DISMISSED', label: 'Eingestellt / Abgelehnt' },
]

/** Einstufung nach dem Sanktionskatalog v1.0 (Abschnitt 01). */
const PENAL_GRADE_OPTIONS: SelectOption[] = [
  { value: '', label: '-- Kein Penal Grade --' },
  ...PENAL_GRADE_ORDER.map((grade) => ({
    value: `GRADE_${grade}`,
    label: `Penal Grade ${grade} — ${PENAL_GRADE_RULES[grade].severity} (${PENAL_GRADE_RULES[grade].typicalConsequence})`,
  })),
]

interface DawFormData {
  caseNumber: string
  title: string
  category: string
  agentId: string
  allegation: string
  statement: string
  penalGrade: string
  sanctionSummary: string
  fineAmount: string
  sgRounds: string
  suspensionHours: string
  status: string
  evidenceUrls: string
  incidentAt: string
  deadlineAt: string
  resolutionNote: string
}

const EMPTY_FORM: DawFormData = {
  caseNumber: '',
  title: '',
  category: 'DAW',
  agentId: '',
  allegation: '',
  statement: '',
  penalGrade: '',
  sanctionSummary: '',
  fineAmount: '',
  sgRounds: '',
  suspensionHours: '',
  status: 'OPEN',
  evidenceUrls: '',
  incidentAt: '',
  deadlineAt: '',
  resolutionNote: '',
}

export function InternalAffairsDawsWorkspace({ canManage }: { canManage: boolean }) {
  const { addToast } = useToast()
  const { execute, loading: saving } = useApi()

  const { data: daws, loading, error, refetch } = useFetch<InternalAffairsDawItem[]>('/api/internal-affairs/daws')
  const { data: agents } = useFetch<AgentSelectOption[]>('/api/internal-affairs/agents')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InternalAffairsDawItem | null>(null)
  const [form, setForm] = useState<DawFormData>(EMPTY_FORM)

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [viewingItem, setViewingItem] = useState<InternalAffairsDawItem | null>(null)

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const agentOptions: SelectOption[] = useMemo(() => {
    const list: SelectOption[] = [{ value: '', label: '-- Keinen / Allgemein --' }]
    if (agents) {
      for (const off of agents) {
        list.push({
          value: off.id,
          label: `${displayBadgeNumber(off.badgeNumber)} · ${off.firstName} ${off.lastName} (${off.rank.name})`,
        })
      }
    }
    return list
  }, [agents])

  const filteredDaws = useMemo(() => {
    if (!daws) return []
    return daws.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false
      if (search.trim()) {
        const query = search.toLowerCase()
        const matchTitle = item.title.toLowerCase().includes(query)
        const matchCase = item.caseNumber?.toLowerCase().includes(query)
        const matchAllegation = item.allegation?.toLowerCase().includes(query)
        const matchAgent =
          item.agent
            ? `${item.agent.firstName} ${item.agent.lastName} ${item.agent.badgeNumber}`.toLowerCase().includes(query)
            : `${item.previousFirstName || ''} ${item.previousLastName || ''} ${item.previousBadgeNumber || ''}`.toLowerCase().includes(query)
        return matchTitle || matchCase || matchAllegation || matchAgent
      }
      return true
    })
  }, [daws, statusFilter, categoryFilter, search])

  const openCreateModal = () => {
    setEditingItem(null)
    setForm({
      ...EMPTY_FORM,
      incidentAt: new Date().toISOString().slice(0, 16),
    })
    setModalOpen(true)
  }

  const openEditModal = (item: InternalAffairsDawItem) => {
    setEditingItem(item)
    setForm({
      caseNumber: item.caseNumber || '',
      title: item.title,
      category: item.category || 'DAW',
      agentId: item.agentId || '',
      allegation: item.allegation || '',
      statement: item.statement || '',
      penalGrade: item.penalGrade || '',
      sanctionSummary: item.sanctionSummary || '',
      fineAmount: item.fineAmount !== null && item.fineAmount !== undefined ? String(item.fineAmount) : '',
      sgRounds: item.sgRounds !== null && item.sgRounds !== undefined ? String(item.sgRounds) : '',
      suspensionHours: item.suspensionHours !== null && item.suspensionHours !== undefined ? String(item.suspensionHours) : '',
      status: item.status || 'OPEN',
      evidenceUrls: item.evidence?.map((e) => e.url).join('\n') || '',
      incidentAt: item.incidentAt ? new Date(item.incidentAt).toISOString().slice(0, 16) : '',
      deadlineAt: item.deadlineAt ? new Date(item.deadlineAt).toISOString().slice(0, 16) : '',
      resolutionNote: item.resolutionNote || '',
    })
    setModalOpen(true)
  }

  const openDetail = (item: InternalAffairsDawItem) => {
    setViewingItem(item)
    setDetailModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      addToast({ type: 'error', title: 'Fehler', message: 'Bitte gib einen Betreff / Titel ein.' })
      return
    }

    const evidenceList = form.evidenceUrls
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((url) => ({ url }))

    const payload = {
      caseNumber: form.caseNumber.trim() || undefined,
      title: form.title.trim(),
      category: form.category,
      agentId: form.agentId || null,
      allegation: form.allegation.trim() || null,
      statement: form.statement.trim() || null,
      penalGrade: form.penalGrade || null,
      sanctionSummary: form.sanctionSummary.trim() || null,
      fineAmount: form.fineAmount ? Number.parseInt(form.fineAmount, 10) : null,
      sgRounds: form.sgRounds ? Number.parseInt(form.sgRounds, 10) : null,
      suspensionHours: form.suspensionHours ? Number.parseInt(form.suspensionHours, 10) : null,
      status: form.status,
      evidence: evidenceList,
      incidentAt: form.incidentAt ? new Date(form.incidentAt).toISOString() : null,
      deadlineAt: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : null,
      resolutionNote: form.resolutionNote.trim() || null,
    }

    const endpoint = editingItem
      ? `/api/internal-affairs/daws/${editingItem.id}`
      : '/api/internal-affairs/daws'
    const method = editingItem ? 'PATCH' : 'POST'

    const res = await execute(endpoint, {
      method,
      body: JSON.stringify(payload),
    })

    if (res) {
      addToast({
        type: 'success',
        title: editingItem ? 'DAW aktualisiert' : 'DAW erfolgreich erstellt',
        message: `Die Akte ${payload.caseNumber || ''} wurde gespeichert.`,
      })
      setModalOpen(false)
      refetch()
      if (viewingItem && editingItem && viewingItem.id === editingItem.id) {
        setViewingItem(res as InternalAffairsDawItem)
      }
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    const res = await execute(`/api/internal-affairs/daws/${deletingId}`, {
      method: 'DELETE',
    })
    if (res) {
      addToast({ type: 'success', title: 'Gelöscht', message: 'Die DAW wurde erfolgreich entfernt.' })
      setDeleteConfirmOpen(false)
      setDeletingId(null)
      if (detailModalOpen) setDetailModalOpen(false)
      refetch()
    }
  }

  if (loading && !daws) return <PageLoader />
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-200">
        <p className="font-semibold">Fehler beim Laden der Internal Affairs DAWs</p>
        <p className="mt-1 text-xs text-red-300/80">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-4">
          <RefreshCw size={14} className="mr-2" /> Erneut versuchen
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dienstaufsichtswarnungen & Disziplinarakten"
        description="Eigenständiges DAW- und Ermittlungssystem der Internal Affairs zur Erfassung von Dienstvergehen, Sanktionen und Dienstanweisungen."
        action={
          canManage && (
            <Button onClick={openCreateModal} className="bg-[#0ea5e9] text-white hover:bg-[#0284c7]">
              <Plus size={16} className="mr-2" /> Neue DAW verfassen
            </Button>
          )
        }
      />

      {/* Filterleiste */}
      <div className="flex flex-col gap-3 rounded-xl border border-[#343434]/60 bg-[#191919]/60 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#767676]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nach Fallnummer, Titel, Agent, Dienstnummer suchen..."
            className="pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            options={CATEGORY_OPTIONS}
            className="w-48"
            size="sm"
          />

          <Select
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={STATUS_OPTIONS}
            className="w-44"
            size="sm"
          />
        </div>
      </div>

      {/* Liste der DAWs */}
      {filteredDaws.length === 0 ? (
        <div className="rounded-2xl border border-[#343434]/50 bg-[#161616]/50 p-12 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-[#767676]" />
          <p className="mt-3 text-base font-semibold text-white">Keine Akten gefunden</p>
          <p className="mt-1 text-xs text-[#a6a6a6]">
            {search || statusFilter !== 'ALL' || categoryFilter !== 'ALL'
              ? 'Passe deine Filterkriterien an, um Ergebnisse anzuzeigen.'
              : 'Es wurden bisher keine Dienstaufsichtswarnungen oder Disziplinarakten angelegt.'}
          </p>
          {canManage && (
            <Button onClick={openCreateModal} variant="secondary" size="sm" className="mt-4">
              <Plus size={14} className="mr-1.5" /> Erste DAW schreiben
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDaws.map((item) => {
            const statusConfig = STATUS_META[item.status] || STATUS_META.OPEN
            const catConfig = CATEGORY_META[item.category] || CATEGORY_META.DAW
            const agentName = item.agent
              ? `${item.agent.firstName} ${item.agent.lastName}`
              : item.previousFirstName
              ? `${item.previousFirstName} ${item.previousLastName}`
              : 'Kein Agent zugewiesen'
            const badge = item.agent ? displayBadgeNumber(item.agent.badgeNumber) : item.previousBadgeNumber || '—'
            const rankName = item.agent?.rank.name || item.previousRank || '—'

            const avatarAgent = {
              firstName: item.agent?.firstName || item.previousFirstName || '',
              lastName: item.agent?.lastName || item.previousLastName || '',
              avatarUrl: item.agent?.avatarUrl || null,
            }

            return (
              <div
                key={item.id}
                className="group flex flex-col justify-between rounded-xl border border-[#343434]/60 bg-[#161616]/80 p-4 transition-all hover:border-[#0ea5e9]/50 hover:bg-[#1e1e1e]"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-[#0ea5e9]">
                      {item.caseNumber || 'DAW-ENTWURF'}
                    </span>
                    <Badge variant={statusConfig.badgeVariant} className="text-[10px] font-medium">
                      {statusConfig.label}
                    </Badge>
                  </div>

                  <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-white group-hover:text-[#7dd3fc]">
                    {item.title}
                  </h3>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    <Badge variant={catConfig.badgeVariant} className="text-[10px]">
                      {catConfig.label}
                    </Badge>
                    {item.penalGrade && (
                      <Badge variant="danger" className="text-[10px]">
                        {item.penalGrade.replace('_', ' ')}
                      </Badge>
                    )}
                  </div>

                  {/* Betroffener Agent */}
                  <div className="mt-3.5 flex items-center gap-2.5 rounded-lg border border-[#343434]/40 bg-[#111111]/60 p-2.5">
                    <AgentAvatar
                      agent={avatarAgent}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">
                        {agentName}
                      </p>
                      <p className="truncate text-[10.5px] text-[#a6a6a6]">
                        {badge} · {rankName}
                      </p>
                    </div>
                  </div>

                  {/* Tatvorwurf Zusammenfassung */}
                  {item.allegation && (
                    <div className="mt-3">
                      <p className="text-[10.5px] font-semibold text-[#a6a6a6]">Tatvorwurf:</p>
                      <p className="line-clamp-2 text-xs text-[#d4d4d4]">{item.allegation}</p>
                    </div>
                  )}

                  {/* Sanktionen / Maßnahmen */}
                  {(item.fineAmount || item.sgRounds || item.suspensionHours || item.sanctionSummary) && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10.5px]">
                      {item.fineAmount ? (
                        <span className="rounded bg-[#292929] px-2 py-0.5 font-medium text-emerald-300">
                          {item.fineAmount.toLocaleString('de-DE')} $
                        </span>
                      ) : null}
                      {item.sgRounds ? (
                        <span className="rounded bg-[#292929] px-2 py-0.5 font-medium text-amber-300">
                          {item.sgRounds} SG-Runden
                        </span>
                      ) : null}
                      {item.suspensionHours ? (
                        <span className="rounded bg-[#292929] px-2 py-0.5 font-medium text-rose-300">
                          {item.suspensionHours}h Suspendierung
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="mt-4 flex items-center justify-between border-t border-[#343434]/40 pt-3 text-[11px] text-[#767676]">
                  <span>{formatDateTime(item.createdAt)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDetail(item)}
                      className="h-7 px-2 text-xs text-[#7dd3fc] hover:bg-[#0ea5e9]/10"
                    >
                      <Eye size={13} className="mr-1" /> Details
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(item)}
                        className="h-7 px-2 text-xs text-[#d4d4d4] hover:bg-white/5"
                      >
                        <FileEdit size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Erstell- & Bearbeitungs-Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingItem ? `DAW bearbeiten (${editingItem.caseNumber || 'Entwurf'})` : 'Neue Dienstaufsichtswarnung verfassen'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Titel / Betreff *</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="z.B. Dienstvergehen / Fehlverhalten im Funk"
                required
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Kategorie *</label>
              <Select
                value={form.category}
                onValueChange={(val) => setForm({ ...form, category: val })}
                options={FORM_CATEGORY_OPTIONS}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Betroffener Agent</label>
              <Select
                value={form.agentId}
                onValueChange={(val) => setForm({ ...form, agentId: val })}
                options={agentOptions}
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Fallnummer (optional)</label>
              <Input
                value={form.caseNumber}
                onChange={(e) => setForm({ ...form, caseNumber: e.target.value })}
                placeholder="z.B. DAW-2026-001 (leer lassen für auto)"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#a6a6a6]">Tatvorwurf / Verstoß</label>
            <Input
              value={form.allegation}
              onChange={(e) => setForm({ ...form, allegation: e.target.value })}
              placeholder="Konkreter Verstoß (z.B. Verstoß gegen §3 Dienstvorschrift, Befehlsverweigerung)"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#a6a6a6]">Sachverhalt / Ausführliche Schilderung</label>
            <Textarea
              value={form.statement}
              onChange={(e) => setForm({ ...form, statement: e.target.value })}
              placeholder="Detaillierte Schilderung der Vorkommnisse, Feststellungen der IA und Aussagen..."
              rows={4}
              className="mt-1"
            />
          </div>

          {/* Sanktionen & Strafmaß */}
          <div className="rounded-xl border border-[#343434]/70 bg-[#161616]/80 p-3.5 space-y-3">
            <p className="text-xs font-bold text-[#7dd3fc]">Sanktion & Disziplinarmaßnahme (Penal Grade)</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-[#a6a6a6]">Penal Grade</label>
                <Select
                  value={form.penalGrade}
                  onValueChange={(val) => setForm({ ...form, penalGrade: val })}
                  options={PENAL_GRADE_OPTIONS}
                  className="mt-1"
                  size="sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#a6a6a6]">Status der Akte</label>
                <Select
                  value={form.status}
                  onValueChange={(val) => setForm({ ...form, status: val })}
                  options={FORM_STATUS_OPTIONS}
                  className="mt-1"
                  size="sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-[#a6a6a6]">Geldstrafe ($)</label>
                <Input
                  type="number"
                  value={form.fineAmount}
                  onChange={(e) => setForm({ ...form, fineAmount: e.target.value })}
                  placeholder="z.B. 20000"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#a6a6a6]">SG-Runden</label>
                <Input
                  type="number"
                  value={form.sgRounds}
                  onChange={(e) => setForm({ ...form, sgRounds: e.target.value })}
                  placeholder="z.B. 2"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#a6a6a6]">Suspendierung (Std.)</label>
                <Input
                  type="number"
                  value={form.suspensionHours}
                  onChange={(e) => setForm({ ...form, suspensionHours: e.target.value })}
                  placeholder="z.B. 48"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Zusätzliche Auflagen / Bemerkung zur Sanktion</label>
              <Input
                value={form.sanctionSummary}
                onChange={(e) => setForm({ ...form, sanctionSummary: e.target.value })}
                placeholder="z.B. Nachschulung bei der Academy, Abgabe der Dienstwaffe für 48h"
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Tatzeitpunkt</label>
              <Input
                type="datetime-local"
                value={form.incidentAt}
                onChange={(e) => setForm({ ...form, incidentAt: e.target.value })}
                className="mt-1 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#a6a6a6]">Frist / Zahlungsziel</label>
              <Input
                type="datetime-local"
                value={form.deadlineAt}
                onChange={(e) => setForm({ ...form, deadlineAt: e.target.value })}
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#a6a6a6]">Beweise & Anhänge (URLs, eine pro Zeile)</label>
            <Textarea
              value={form.evidenceUrls}
              onChange={(e) => setForm({ ...form, evidenceUrls: e.target.value })}
              placeholder="https://i.imgur.com/...&#10;https://medal.tv/..."
              rows={2}
              className="mt-1 text-xs font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#a6a6a6]">Abschlussvermerk / Ergebnis (optional)</label>
            <Textarea
              value={form.resolutionNote}
              onChange={(e) => setForm({ ...form, resolutionNote: e.target.value })}
              placeholder="Begründung der Einstellung, Zahlungsnachweis oder Prüfungsergebnis..."
              rows={2}
              className="mt-1 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving} className="bg-[#0ea5e9] text-white hover:bg-[#0284c7]">
              {saving ? 'Speichert...' : editingItem ? 'Änderungen speichern' : 'DAW anlegen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail-Modal */}
      {viewingItem && (
        <Modal
          open={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          title={`Fallakte: ${viewingItem.caseNumber || 'Entwurf'}`}
        >
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#343434]/40 pb-3">
              <div>
                <span className="font-mono text-xs font-bold text-[#0ea5e9]">
                  {viewingItem.caseNumber || 'DAW-ENTWURF'}
                </span>
                <h2 className="text-base font-bold text-white">{viewingItem.title}</h2>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={(STATUS_META[viewingItem.status] || STATUS_META.OPEN).badgeVariant} className="text-xs font-semibold">
                  {(STATUS_META[viewingItem.status] || STATUS_META.OPEN).label}
                </Badge>
              </div>
            </div>

            {/* Agent Box */}
            <div className="rounded-xl border border-[#343434]/60 bg-[#161616] p-3.5 flex items-center gap-3">
              <AgentAvatar
                agent={{
                  firstName: viewingItem.agent?.firstName || viewingItem.previousFirstName || '',
                  lastName: viewingItem.agent?.lastName || viewingItem.previousLastName || '',
                  avatarUrl: viewingItem.agent?.avatarUrl || null,
                }}
                size="md"
              />
              <div>
                <p className="text-xs text-[#a6a6a6]">Betroffener Agent</p>
                <p className="font-bold text-white">
                  {viewingItem.agent
                    ? `${viewingItem.agent.firstName} ${viewingItem.agent.lastName}`
                    : viewingItem.previousFirstName
                    ? `${viewingItem.previousFirstName} ${viewingItem.previousLastName}`
                    : 'Nicht zugewiesen'}
                </p>
                <p className="text-xs text-[#7dd3fc]">
                  Dienstnummer: {viewingItem.agent ? displayBadgeNumber(viewingItem.agent.badgeNumber) : viewingItem.previousBadgeNumber || '—'} · Rang: {viewingItem.agent?.rank.name || viewingItem.previousRank || '—'}
                </p>
              </div>
            </div>

            {/* Tatvorwurf & Sachverhalt */}
            {viewingItem.allegation && (
              <div className="rounded-xl border border-[#343434]/40 bg-[#111111]/70 p-3.5">
                <p className="text-xs font-bold text-[#a6a6a6]">Tatvorwurf / Anschuldigung:</p>
                <p className="mt-1 text-white">{viewingItem.allegation}</p>
              </div>
            )}

            {viewingItem.statement && (
              <div className="rounded-xl border border-[#343434]/40 bg-[#111111]/70 p-3.5">
                <p className="text-xs font-bold text-[#a6a6a6]">Sachverhalt & Ermittlungsbericht:</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-[#d4d4d4] leading-relaxed">
                  {viewingItem.statement}
                </p>
              </div>
            )}

            {/* Sanktionen */}
            {(viewingItem.penalGrade || viewingItem.fineAmount || viewingItem.sgRounds || viewingItem.suspensionHours || viewingItem.sanctionSummary) && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 space-y-2">
                <p className="text-xs font-bold text-rose-300">Festgesetzte Disziplinarmaßnahme:</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {viewingItem.penalGrade && (
                    <Badge variant="danger" className="text-rose-200">
                      {viewingItem.penalGrade.replace('_', ' ')}
                    </Badge>
                  )}
                  {viewingItem.fineAmount ? (
                    <span className="rounded bg-[#292929] px-2.5 py-1 font-semibold text-emerald-300">
                      Geldstrafe: {viewingItem.fineAmount.toLocaleString('de-DE')} $
                    </span>
                  ) : null}
                  {viewingItem.sgRounds ? (
                    <span className="rounded bg-[#292929] px-2.5 py-1 font-semibold text-amber-300">
                      SG: {viewingItem.sgRounds} Runden
                    </span>
                  ) : null}
                  {viewingItem.suspensionHours ? (
                    <span className="rounded bg-[#292929] px-2.5 py-1 font-semibold text-rose-300">
                      Suspendierung: {viewingItem.suspensionHours} Stunden
                    </span>
                  ) : null}
                </div>
                {viewingItem.sanctionSummary && (
                  <p className="text-xs text-rose-200/90 pt-1">
                    <span className="font-semibold">Auflagen:</span> {viewingItem.sanctionSummary}
                  </p>
                )}
              </div>
            )}

            {/* Beweise */}
            {viewingItem.evidence && viewingItem.evidence.length > 0 && (
              <div className="rounded-xl border border-[#343434]/40 bg-[#111111]/70 p-3.5 space-y-2">
                <p className="text-xs font-bold text-[#a6a6a6]">Beweismittel & Links:</p>
                <div className="flex flex-col gap-1.5">
                  {viewingItem.evidence.map((ev, idx) => (
                    <a
                      key={idx}
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-[#0ea5e9] hover:underline"
                    >
                      <Link2 size={13} /> {ev.title || ev.url} <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Abschlussnotiz */}
            {viewingItem.resolutionNote && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
                <p className="text-xs font-bold text-emerald-300">Abschlussvermerk / Ergebnis:</p>
                <p className="mt-1 text-xs text-[#d4d4d4] whitespace-pre-wrap">{viewingItem.resolutionNote}</p>
              </div>
            )}

            {/* Metadaten */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#343434]/40 pt-3 text-[11px] text-[#767676]">
              <div>
                Erstellt am {formatDateTime(viewingItem.createdAt)} von {viewingItem.createdBy?.displayName || 'Unbekannt'}
              </div>
              {viewingItem.incidentAt && <div>Tatzeitpunkt: {formatDateTime(viewingItem.incidentAt)}</div>}
            </div>

            <div className="flex justify-between gap-2 pt-2">
              {canManage ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDeletingId(viewingItem.id)
                    setDeleteConfirmOpen(true)
                  }}
                >
                  <Trash2 size={14} className="mr-1.5" /> Löschen
                </Button>
              ) : <div />}

              <div className="flex gap-2">
                {canManage && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDetailModalOpen(false)
                      openEditModal(viewingItem)
                    }}
                  >
                    <FileEdit size={14} className="mr-1.5" /> Bearbeiten
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => setDetailModalOpen(false)}>
                  Schließen
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Lösch-Bestätigung */}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="DAW löschen"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-[#d4d4d4]">
            Möchtest du diesen Internal-Affairs-Eintrag wirklich unwiderruflich löschen?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={saving}>
              {saving ? 'Löscht...' : 'Endgültig löschen'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
