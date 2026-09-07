'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Copy,
  ExternalLink,
  FileSignature,
  Plus,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import {
  SIGNATURE_ROLES,
  SIGNATURE_ROLE_META,
  TRANSFER_REQUEST_STATUSES,
  TRANSFER_REQUEST_STATUS_META,
  type SignatureRole,
  type TransferRequestStatusValue,
  type TransferSignatureState,
} from '@/lib/transfer-requests'
import { cn, formatDateTime } from '@/lib/utils'

interface AgentOption {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  status: string
  rank?: { name: string } | null
}

interface TransferRow {
  id: string
  requestNumber: string
  token: string
  url: string
  title: string
  agentId: string | null
  agentName: string
  badgeNumber: string | null
  rankName: string | null
  targetAuthority: string | null
  status: TransferRequestStatusValue
  signatures: TransferSignatureState[]
  declineReason: string | null
  createdBy: { id: string; displayName: string } | null
  createdAt: string
  updatedAt: string
}

type StatusFilter = 'ALL' | 'OPEN' | TransferRequestStatusValue

const filterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'OPEN', label: 'Offen' },
  { value: 'ALL', label: 'Alle' },
  ...TRANSFER_REQUEST_STATUSES.map((status) => ({
    value: status as StatusFilter,
    label: TRANSFER_REQUEST_STATUS_META[status].shortLabel,
  })),
]

const OPEN_STATUSES: TransferRequestStatusValue[] = ['DRAFT', 'SENT', 'IN_SIGNING']

export function TransfersWorkspace({ canManage }: { canManage: boolean }) {
  const { data: requests, loading, error: loadError, refetch } = useFetch<TransferRow[]>('/api/transfer-requests')
  const { data: agents } = useFetch<AgentOption[]>('/api/agents')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN')
  const [createOpen, setCreateOpen] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [agentId, setAgentId] = useState('')
  const [targetAuthority, setTargetAuthority] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (requests ?? []).filter((request) => {
      const statusOk = statusFilter === 'ALL'
        ? true
        : statusFilter === 'OPEN'
          ? OPEN_STATUSES.includes(request.status)
          : request.status === statusFilter
      if (!statusOk) return false
      if (!query) return true
      return `${request.requestNumber} ${request.agentName} ${request.badgeNumber ?? ''} ${request.targetAuthority ?? ''}`
        .toLowerCase()
        .includes(query)
    })
  }, [requests, search, statusFilter])

  const agentMatches = useMemo(() => {
    const query = agentQuery.trim().toLowerCase()
    const list = (agents ?? []).filter((agent) => agent.status !== 'TERMINATED')
    if (!query) return list.slice(0, 8)
    return list
      .filter((agent) => (
        `${agent.firstName} ${agent.lastName} ${agent.badgeNumber}`.toLowerCase().includes(query)
      ))
      .slice(0, 8)
  }, [agents, agentQuery])

  const selectedAgent = (agents ?? []).find((agent) => agent.id === agentId) ?? null

  const create = async () => {
    if (!agentId) {
      addToast({ type: 'error', title: 'Bitte wähle einen Agent aus' })
      return
    }
    setSaving(true)
    try {
      const created = await execute('/api/transfer-requests', {
        method: 'POST',
        body: JSON.stringify({ agentId, targetAuthority }),
      }) as TransferRow | null
      addToast({
        type: 'success',
        title: `Versetzungsantrag ${created?.requestNumber ?? ''} erstellt`,
        message: 'Der Link kann jetzt an den Beamten geschickt werden.',
      })
      setCreateOpen(false)
      setAgentId('')
      setAgentQuery('')
      setTargetAuthority('')
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Anlegen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async (request: TransferRow) => {
    try {
      await navigator.clipboard.writeText(request.url)
      addToast({ type: 'success', title: 'Link kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Kopieren fehlgeschlagen', message: request.url })
    }
  }

  const patch = async (request: TransferRow, action: 'cancel' | 'reopen') => {
    try {
      await execute(`/api/transfer-requests/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      addToast({ type: 'success', title: action === 'cancel' ? 'Antrag zurückgezogen' : 'Antrag reaktiviert' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Aktion fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    }
  }

  const remove = async (request: TransferRow) => {
    if (!confirm(`Versetzungsantrag ${request.requestNumber} wirklich löschen?`)) return
    try {
      await execute(`/api/transfer-requests/${request.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Antrag gelöscht' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Versetzungsanträge"
        description="Antrag als Link erstellen, an den Beamten schicken und die drei Unterschriften verfolgen."
        action={canManage ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={14} strokeWidth={2} />
            Antrag erstellen
          </Button>
        ) : undefined}
      />

      {loadError && (
        <div className="rounded-[12px] border border-[#3b1616] bg-[#1c1111] px-4 py-3 text-[12.5px] text-[#fca5a5]">
          {loadError}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#808080]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Aktenzeichen, Name oder Behörde suchen"
            className="h-[36px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818] pl-8 pr-3 text-[13px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={cn(
                'rounded-[7px] border px-2 py-1 text-[11px] font-medium transition-colors',
                statusFilter === option.value
                  ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                  : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <section className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 py-14 text-center">
          <FileSignature size={28} className="mx-auto mb-3 text-[#808080]" />
          <p className="text-[14px] font-semibold text-white">Kein Versetzungsantrag vorhanden</p>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
            {canManage ? 'Lege den ersten Antrag über „Antrag erstellen“ an.' : 'Erstellte Anträge erscheinen hier.'}
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {filtered.map((request) => (
            <TransferCard
              key={request.id}
              request={request}
              canManage={canManage}
              onCopy={() => void copyLink(request)}
              onCancel={() => void patch(request, 'cancel')}
              onReopen={() => void patch(request, 'reopen')}
              onDelete={() => void remove(request)}
            />
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Versetzungsantrag erstellen"
        description="Der Beamte bekommt einen Link zum Ausfüllen und Unterschreiben."
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-[#aeaeae]">Agent</p>
            {selectedAgent ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-[#d4d4d4]/35 bg-[#d4d4d4]/10 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-white">
                    {selectedAgent.firstName} {selectedAgent.lastName}
                  </p>
                  <p className="truncate text-[11.5px] text-[#a6a6a6]">
                    {selectedAgent.badgeNumber} · {selectedAgent.rank?.name ?? 'Ohne Rang'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAgentId('')}>Ändern</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#808080]" />
                  <input
                    value={agentQuery}
                    onChange={(event) => setAgentQuery(event.target.value)}
                    placeholder="Name oder Dienstnummer"
                    className="h-[36px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818] pl-8 pr-3 text-[13.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
                  />
                </div>
                <div className="mt-2 max-h-[200px] space-y-1 overflow-y-auto rounded-[9px] border border-[#343434]/55 bg-[#181818]/45 p-1.5">
                  {agentMatches.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setAgentId(agent.id)}
                      className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[#232323]/70"
                    >
                      <span className="font-mono text-[11px] text-[#d4d4d4]">{agent.badgeNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white">
                        {agent.firstName} {agent.lastName}
                      </span>
                      <span className="truncate text-[11px] text-[#909090]">{agent.rank?.name}</span>
                    </button>
                  ))}
                  {agentMatches.length === 0 && (
                    <p className="px-2 py-3 text-center text-[12px] text-[#909090]">Kein Agent gefunden.</p>
                  )}
                </div>
              </>
            )}
          </div>

          <Input
            label="Entgegennehmende Behörde (optional)"
            value={targetAuthority}
            onChange={(event) => setTargetAuthority(event.target.value)}
            placeholder="z. B. Los Santos Sheriff Department"
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={create} loading={saving}>
              <FileSignature size={13} />
              Antrag erstellen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function TransferCard({
  request,
  canManage,
  onCopy,
  onCancel,
  onReopen,
  onDelete,
}: {
  request: TransferRow
  canManage: boolean
  onCopy: () => void
  onCancel: () => void
  onReopen: () => void
  onDelete: () => void
}) {
  const meta = TRANSFER_REQUEST_STATUS_META[request.status]
  const closed = request.status === 'CANCELLED' || request.status === 'DECLINED'

  return (
    <article className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[6px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/10 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-[#d4d4d4]">
          {request.requestNumber}
        </span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span className="text-[11.5px] text-[#909090]">Aktualisiert {formatDateTime(request.updatedAt)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-white">{request.agentName}</h3>
        <span className="text-[12px] text-[#a6a6a6]">
          {request.badgeNumber ?? '—'} · {request.rankName ?? 'Ohne Rang'}
        </span>
      </div>
      <p className="mt-0.5 text-[12.5px] text-[#a6a6a6]">
        Ziel: {request.targetAuthority || 'noch nicht angegeben'}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {SIGNATURE_ROLES.map((role) => (
          <SignatureBadge key={role} role={role} signatures={request.signatures} />
        ))}
      </div>

      {request.declineReason && (
        <p className="mt-3 rounded-[9px] border border-[#7f1d1d]/40 bg-[#2a1620]/50 px-3 py-2 text-[12px] text-[#f3b7b7]">
          Grund: {request.declineReason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy size={13} />
          Link kopieren
        </Button>
        <Link href={`/versetzung/${request.token}`} target="_blank">
          <Button variant="outline" size="sm" type="button">
            <ExternalLink size={13} />
            Öffnen
          </Button>
        </Link>
        {canManage && !closed && (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Zurückziehen
          </Button>
        )}
        {canManage && closed && (
          <Button variant="secondary" size="sm" onClick={onReopen}>
            <Undo2 size={13} />
            Reaktivieren
          </Button>
        )}
        {canManage && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-[8px] border border-[#7f1d1d]/50 px-2.5 py-1 text-[12px] font-medium text-[#fca5a5] transition-colors hover:bg-[#2a1620]/60"
          >
            <Trash2 size={12} />
            Löschen
          </button>
        )}
      </div>
    </article>
  )
}

function SignatureBadge({
  role,
  signatures,
}: {
  role: SignatureRole
  signatures: TransferSignatureState[]
}) {
  const signature = signatures.find((entry) => entry.role === role)
  const meta = SIGNATURE_ROLE_META[role]
  const signed = Boolean(signature?.signedAt)

  return (
    <div
      className={cn(
        'rounded-[10px] border px-3 py-2',
        signed ? 'border-[#1d4230]/60 bg-[#0d2419]/60' : 'border-[#343434]/45 bg-[#181818]/55',
      )}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#808080]">{meta.title}</p>
      <p className={cn('mt-1 truncate text-[12.5px]', signed ? 'text-[#9fd9b6]' : 'text-[#909090]')}>
        {signed ? signature?.name : 'Offen'}
      </p>
      {signed && signature?.signedAt && (
        <p className="mt-0.5 text-[11px] text-[#686868]">{formatDateTime(signature.signedAt)}</p>
      )}
    </div>
  )
}
