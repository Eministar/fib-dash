'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Copy,
  FileSignature,
  FileText,
  Plus,
  Send,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import {
  CONTRACT_STATUS_META,
  DEFAULT_CONTRACT_TEMPLATE_CLAUSES,
  DEFAULT_CONTRACT_TEMPLATE_CLOSING,
  DEFAULT_CONTRACT_TEMPLATE_CONTENT,
  DEFAULT_CONTRACT_TEMPLATE_FIELDS,
  DEFAULT_CONTRACT_TEMPLATE_NAME,
  readContractClauses,
  readContractFields,
  type ContractStatusValue,
} from '@/lib/contracts'
import {
  ContractTemplateEditor,
  type ContractTemplateForm,
} from '@/components/contracts/contract-template-editor'

interface TemplateRow {
  id: string
  name: string
  description: string | null
  content: string
  clauses: unknown
  closing: string | null
  fields: unknown
  active: boolean
  isDefault: boolean
  updatedAt: string
  createdBy: { id: string; displayName: string } | null
  _count: { contracts: number }
}

interface ContractRow {
  id: string
  title: string
  status: ContractStatusValue
  token: string
  sentAt: string | null
  sentVia: string | null
  sendCount: number
  lastSendError: string | null
  signedAt: string | null
  signedName: string | null
  createdAt: string
  agent: {
    id: string
    firstName: string
    lastName: string
    badgeNumber: string
    discordId: string | null
  }
  application: { id: string; applicantDisplayName: string } | null
}

const EMPTY_TEMPLATE: ContractTemplateForm = {
  name: DEFAULT_CONTRACT_TEMPLATE_NAME,
  description: '',
  content: DEFAULT_CONTRACT_TEMPLATE_CONTENT,
  clauses: DEFAULT_CONTRACT_TEMPLATE_CLAUSES,
  closing: DEFAULT_CONTRACT_TEMPLATE_CLOSING,
  fields: DEFAULT_CONTRACT_TEMPLATE_FIELDS,
  active: true,
  isDefault: false,
}

interface PendingAgentRow {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId: string | null
  status: string
  hireDate: string
  rank: { id: string; name: string; sortOrder: number } | null
  contract: { signed: boolean; pending: boolean; missing: boolean }
  latestContract: {
    id: string
    status: ContractStatusValue
    sentAt: string | null
    sendCount: number
    lastSendError: string | null
  } | null
}

type Tab = 'contracts' | 'pending' | 'templates'

export function ContractsWorkspace({ canManage }: { canManage: boolean }) {
  const { data: templates, loading: templatesLoading, refetch: refetchTemplates } =
    useFetch<TemplateRow[]>('/api/contract-templates')
  const { data: contracts, loading: contractsLoading, refetch: refetchContracts } =
    useFetch<ContractRow[]>('/api/contracts')
  const { data: pendingAgents, refetch: refetchPending } =
    useFetch<PendingAgentRow[]>('/api/contracts/pending')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [tab, setTab] = useState<Tab>('contracts')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ContractTemplateForm>(EMPTY_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [templateToDelete, setTemplateToDelete] = useState<TemplateRow | null>(null)

  const stats = useMemo(() => {
    const list = contracts ?? []
    return {
      open: list.filter((row) => row.status === 'DRAFT' || row.status === 'SENT').length,
      signed: list.filter((row) => row.status === 'SIGNED').length,
      declined: list.filter((row) => row.status === 'DECLINED').length,
      total: list.length,
    }
  }, [contracts])

  const openEditor = (template: TemplateRow | null) => {
    if (template) {
      setEditingId(template.id)
      setForm({
        name: template.name,
        description: template.description ?? '',
        content: template.content,
        clauses: readContractClauses(template.clauses),
        closing: template.closing ?? '',
        fields: readContractFields(template.fields),
        active: template.active,
        isDefault: template.isDefault,
      })
    } else {
      setEditingId(null)
      setForm(EMPTY_TEMPLATE)
    }
    setEditorOpen(true)
  }

  const saveTemplate = async () => {
    if (!form.name.trim()) {
      addToast({ type: 'error', title: 'Name fehlt', message: 'Die Vorlage braucht einen Namen.' })
      return
    }
    setSaving(true)
    try {
      await execute(editingId ? `/api/contract-templates/${editingId}` : '/api/contract-templates', {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      })
      addToast({ type: 'success', title: editingId ? 'Vorlage gespeichert' : 'Vorlage erstellt' })
      setEditorOpen(false)
      await refetchTemplates()
    } catch (e) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const deleteTemplate = async () => {
    if (!templateToDelete) return
    try {
      await execute(`/api/contract-templates/${templateToDelete.id}`, { method: 'DELETE' })
      addToast({
        type: 'success',
        title: templateToDelete._count.contracts > 0 ? 'Vorlage deaktiviert' : 'Vorlage gelöscht',
      })
      setTemplateToDelete(null)
      await refetchTemplates()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    }
  }

  const resend = async (contract: ContractRow) => {
    setSendingId(contract.id)
    try {
      await execute(`/api/contracts/${contract.id}/send`, { method: 'POST' })
      addToast({ type: 'success', title: 'Vertragsnachricht gesendet' })
      await Promise.all([refetchContracts(), refetchPending()])
    } catch (e) {
      addToast({ type: 'error', title: 'Versand fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSendingId(null)
    }
  }

  /**
   * Unterschrift bei einem Bestandsmitarbeiter anfordern: existiert schon ein
   * offener Vertrag, wird nur erneut zugestellt — sonst wird einer erzeugt.
   */
  const requestSignature = async (row: PendingAgentRow) => {
    setSendingId(row.id)
    try {
      const openContract = row.latestContract &&
        (row.latestContract.status === 'DRAFT' || row.latestContract.status === 'SENT')
        ? row.latestContract
        : null

      if (openContract) {
        await execute(`/api/contracts/${openContract.id}/send`, { method: 'POST' })
      } else {
        await execute('/api/contracts', {
          method: 'POST',
          body: JSON.stringify({ agentId: row.id }),
        })
      }
      addToast({ type: 'success', title: 'Unterschrift angefordert' })
      await Promise.all([refetchContracts(), refetchPending()])
    } catch (e) {
      addToast({ type: 'error', title: 'Anfrage fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSendingId(null)
    }
  }

  const requestAllSignatures = async () => {
    const targets = pendingAgents ?? []
    if (targets.length === 0) return
    setSendingId('__all__')
    let sent = 0
    let failed = 0
    // Bewusst sequenziell: der Discord-Versand läuft ohnehin durch eine
    // Rate-Limit-Queue, und so bleibt bei einem Fehler nachvollziehbar, wie
    // viele Nachrichten schon rausgegangen sind.
    for (const row of targets) {
      try {
        const openContract = row.latestContract &&
          (row.latestContract.status === 'DRAFT' || row.latestContract.status === 'SENT')
          ? row.latestContract
          : null
        if (openContract) {
          await execute(`/api/contracts/${openContract.id}/send`, { method: 'POST' })
        } else {
          await execute('/api/contracts', { method: 'POST', body: JSON.stringify({ agentId: row.id }) })
        }
        sent += 1
      } catch {
        failed += 1
      }
    }
    addToast({
      type: failed > 0 ? 'warning' : 'success',
      title: `${sent} Unterschrift(en) angefordert`,
      message: failed > 0 ? `${failed} konnten nicht zugestellt werden.` : undefined,
    })
    await Promise.all([refetchContracts(), refetchPending()])
    setSendingId(null)
  }

  const copyLink = async (contract: ContractRow) => {
    const url = `${window.location.origin}/vertrag/${contract.token}`
    try {
      await navigator.clipboard.writeText(url)
      addToast({ type: 'success', title: 'Vertragslink kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Kopieren fehlgeschlagen', message: url })
    }
  }

  if (templatesLoading || contractsLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Arbeitsverträge"
        description="Vertragsvorlagen pflegen, Verträge versenden und den Unterschriftsstand im Blick behalten."
        action={
          canManage && tab === 'templates' ? (
            <Button size="sm" onClick={() => openEditor(null)}>
              <Plus size={14} />
              Neue Vorlage
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Offen" value={stats.open} />
        <StatCard label="Unterschrieben" value={stats.signed} />
        <StatCard label="Ohne Unterschrift" value={pendingAgents?.length ?? 0} />
        <StatCard label="Gesamt" value={stats.total} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'contracts' as const, label: 'Verträge', icon: FileSignature },
            { id: 'pending' as const, label: 'Ohne Unterschrift', icon: UserRound },
            { id: 'templates' as const, label: 'Vorlagen', icon: FileText },
          ]
        ).map((entry) => {
          const Icon = entry.icon
          const active = tab === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors',
                active
                  ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                  : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
              )}
            >
              <Icon size={14} />
              {entry.label}
            </button>
          )
        })}
      </div>

      {tab === 'contracts' ? (
        <section className="overflow-hidden rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70">
          {(contracts ?? []).length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="Noch keine Verträge"
              description="Verträge entstehen automatisch beim Einstellen eines Agents oder manuell auf der Agent-Seite."
            />
          ) : (
            <div className="divide-y divide-[#343434]/35">
              {contracts?.map((contract) => (
                <ContractListRow
                  key={contract.id}
                  contract={contract}
                  canManage={canManage}
                  sending={sendingId === contract.id}
                  onResend={() => resend(contract)}
                  onCopy={() => copyLink(contract)}
                />
              ))}
            </div>
          )}
        </section>
      ) : tab === 'pending' ? (
        <section className="overflow-hidden rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70">
          {(pendingAgents ?? []).length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="Alle Mitarbeiter haben unterschrieben"
              description="Es gibt aktuell keinen aktiven Mitarbeiter ohne unterschriebenen Arbeitsvertrag."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#343434]/45 px-4 py-3">
                <p className="max-w-xl text-[12.5px] leading-5 text-[#a6a6a6]">
                  Diese Mitarbeiter haben noch keinen unterschriebenen Arbeitsvertrag. Bei neuen
                  Agentn gilt die Einstellung erst mit Unterschrift als abgeschlossen.
                </p>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={requestAllSignatures}
                    loading={sendingId === '__all__'}
                  >
                    <Send size={13} />
                    Alle anschreiben
                  </Button>
                )}
              </div>
              <div className="divide-y divide-[#343434]/35">
                {pendingAgents?.map((row) => (
                  <PendingAgentListRow
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    sending={sendingId === row.id || sendingId === '__all__'}
                    onRequest={() => requestSignature(row)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="space-y-3">
          {(templates ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Noch keine Vertragsvorlage"
              description="Lege eine Vorlage an — sie wird beim Einstellen neuer Agent automatisch verwendet."
            />
          ) : (
            templates?.map((template) => (
              <article
                key={template.id}
                className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <h3 className="text-[14.5px] font-semibold text-white">{template.name}</h3>
                      {template.isDefault && (
                        <Badge variant="warning">
                          <Star size={11} className="mr-1" />
                          Standard
                        </Badge>
                      )}
                      {!template.active && <Badge>Deaktiviert</Badge>}
                    </div>
                    {template.description && (
                      <p className="text-[12.5px] text-[#a6a6a6]">{template.description}</p>
                    )}
                    <p className="mt-1.5 text-[11.5px] text-[#909090]">
                      {readContractClauses(template.clauses).length} Regelungen ·{' '}
                      {readContractFields(template.fields).length} Felder ·{' '}
                      {template._count.contracts} Vertrag/Verträge · geändert{' '}
                      {formatDateTime(template.updatedAt)}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEditor(template)}>
                        Bearbeiten
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTemplateToDelete(template)}
                        aria-label="Vorlage entfernen"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      )}

      <ContractTemplateEditor
        open={editorOpen}
        isEditing={Boolean(editingId)}
        form={form}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        saving={saving}
        onSave={saveTemplate}
        onClose={() => setEditorOpen(false)}
      />

      <Modal
        open={Boolean(templateToDelete)}
        onClose={() => setTemplateToDelete(null)}
        title="Vorlage entfernen"
      >
        <p className="text-[13px] leading-5 text-[#c3c3c3]">
          {templateToDelete && templateToDelete._count.contracts > 0
            ? `„${templateToDelete.name}“ wird von ${templateToDelete._count.contracts} Vertrag/Verträgen genutzt und deshalb nur deaktiviert. Bestehende Verträge bleiben unverändert gültig.`
            : `„${templateToDelete?.name}“ wird dauerhaft gelöscht.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTemplateToDelete(null)}>
            Abbrechen
          </Button>
          <Button variant="danger" size="sm" onClick={deleteTemplate}>
            {templateToDelete && templateToDelete._count.contracts > 0 ? 'Deaktivieren' : 'Löschen'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function ContractListRow({
  contract,
  canManage,
  sending,
  onResend,
  onCopy,
}: {
  contract: ContractRow
  canManage: boolean
  sending: boolean
  onResend: () => void
  onCopy: () => void
}) {
  const meta = CONTRACT_STATUS_META[contract.status]
  const open = contract.status === 'DRAFT' || contract.status === 'SENT'

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#232323] text-[#d4d4d4]">
          <UserRound size={16} />
        </span>
        <div className="min-w-0">
          <Link
            href={`/agents/${contract.agent.id}`}
            className="truncate text-[13.5px] font-semibold text-white hover:text-[#d4d4d4]"
          >
            {contract.agent.firstName} {contract.agent.lastName}
          </Link>
          <p className="mt-0.5 truncate text-[11.5px] text-[#909090]">
            {contract.title} · DN {contract.agent.badgeNumber}
            {contract.application ? ` · Bewerbung: ${contract.application.applicantDisplayName}` : ''}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#808080]">
            {contract.status === 'SIGNED'
              ? `Unterschrieben ${formatDateTime(contract.signedAt)} von ${contract.signedName ?? '—'}`
              : contract.sentAt
                ? `Gesendet ${formatDateTime(contract.sentAt)}${contract.sentVia === 'channel' ? ' (Channel, DM nicht möglich)' : ' (DM)'}`
                : 'Noch nicht versendet'}
            {contract.lastSendError ? ` · ${contract.lastSendError}` : ''}
          </p>
        </div>
      </div>

      <Badge variant={meta.variant}>{meta.shortLabel}</Badge>

      {canManage && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCopy} aria-label="Vertragslink kopieren">
            <Copy size={14} />
          </Button>
          {open && (
            <Button size="sm" variant="outline" onClick={onResend} loading={sending}>
              <Send size={13} />
              Vertragsnachricht
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function PendingAgentListRow({
  row,
  canManage,
  sending,
  onRequest,
}: {
  row: PendingAgentRow
  canManage: boolean
  sending: boolean
  onRequest: () => void
}) {
  const hasOpenContract = Boolean(
    row.latestContract &&
      (row.latestContract.status === 'DRAFT' || row.latestContract.status === 'SENT'),
  )

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#232323] text-[#d4d4d4]">
          <UserRound size={16} />
        </span>
        <div className="min-w-0">
          <Link
            href={`/agents/${row.id}`}
            className="truncate text-[13.5px] font-semibold text-white hover:text-[#d4d4d4]"
          >
            {row.firstName} {row.lastName}
          </Link>
          <p className="mt-0.5 truncate text-[11.5px] text-[#909090]">
            DN {row.badgeNumber} · {row.rank?.name ?? '—'} · seit {formatDateTime(row.hireDate)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#808080]">
            {hasOpenContract
              ? `Vertrag versendet · ${row.latestContract?.sendCount ?? 0}× angeschrieben`
              : row.latestContract
                ? `Letzter Vertrag: ${CONTRACT_STATUS_META[row.latestContract.status].label}`
                : 'Noch kein Vertrag angelegt'}
            {!row.discordId ? ' · keine Discord-ID hinterlegt' : ''}
          </p>
        </div>
      </div>

      <Badge variant={hasOpenContract ? 'warning' : 'danger'}>
        {hasOpenContract ? 'Wartet auf Unterschrift' : 'Kein Vertrag'}
      </Badge>

      {canManage && (
        <Button size="sm" variant="outline" onClick={onRequest} loading={sending}>
          <Send size={13} />
          {hasOpenContract ? 'Erneut senden' : 'Unterschrift beantragen'}
        </Button>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-white/[0.04] bg-[#1b1b1b]/70 px-4 py-3">
      <p className="text-[20px] font-semibold leading-tight text-white tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-[#a6a6a6]">{label}</p>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText
  title: string
  description: string
}) {
  return (
    <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 py-14 text-center">
      <Icon size={28} className="mx-auto mb-3 text-[#808080]" />
      <p className="text-[14px] font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-[#a6a6a6]">{description}</p>
    </div>
  )
}
