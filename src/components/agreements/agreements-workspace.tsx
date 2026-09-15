'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, FileSignature, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { readContractClauses } from '@/lib/contracts'
import { AGREEMENT_STATUSES, AGREEMENT_STATUS_META, type AgreementLetterhead, type AgreementStatus } from '@/lib/agreements'
import { cn, formatDateTime } from '@/lib/utils'
import { AgreementDocument } from './agreement-document'
import { AgreementEditor, emptyDraft, type AgreementDraft, type AgreementTemplateRow } from './agreement-editor'

interface ListRow {
  id: string
  title: string
  status: AgreementStatus
  updatedAt: string
  parties: { name: string; signedAt: string | null; declinedAt: string | null }[]
}

interface PartyRow {
  id: string
  name: string
  role: string | null
  sortOrder: number
  token: string
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
  declineReason: string | null
}

interface DetailRow {
  id: string
  title: string
  status: AgreementStatus
  letterhead: AgreementLetterhead
  content: string
  clauses: unknown
  closing: string | null
  templateId: string | null
  releasedAt: string | null
  parties: PartyRow[]
}

const draftFrom = (row: DetailRow): AgreementDraft => ({
  title: row.title,
  letterhead: row.letterhead,
  content: row.content,
  closing: row.closing ?? '',
  templateId: row.templateId ?? '',
  clauses: readContractClauses(row.clauses).map((clause) => ({ key: clause.id, title: clause.title, body: clause.body })),
  parties: row.parties.map((party) => ({ key: party.id, id: party.id, name: party.name, role: party.role ?? '' })),
})

const templateDraft = (row: AgreementTemplateRow): AgreementDraft => ({
  ...emptyDraft(),
  title: row.name,
  letterhead: row.letterhead,
  content: row.content,
  closing: row.closing ?? '',
  clauses: readContractClauses(row.clauses).map((clause) => ({ key: clause.id, title: clause.title, body: clause.body })),
  parties: [],
})

const clausePayload = (draft: AgreementDraft) =>
  draft.clauses
    .filter((clause) => clause.title.trim() || clause.body.trim())
    .map((clause, index) => ({ id: clause.key, title: clause.title.trim(), body: clause.body.trim(), sortOrder: index }))

function LinkRow({ agreementId, party, canManage, canRegenerate, onChanged }: { agreementId: string; party: PartyRow; canManage: boolean; canRegenerate: boolean; onChanged: () => Promise<unknown> }) {
  const { execute, loading } = useApi()
  const { addToast } = useToast()
  const [copied, setCopied] = useState(false)
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/unterschrift/${party.token}`
  const state = party.declinedAt ? `Abgelehnt${party.declineReason ? ` · ${party.declineReason}` : ''}` : party.signedAt ? `Unterschrieben von ${party.signedName} · ${formatDateTime(party.signedAt)}` : 'Offen'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Recht bleibt der Link im Feld zum Markieren.
    }
  }

  const regenerate = async () => {
    try {
      await execute(`/api/agreements/${agreementId}/parties/${party.id}/token`, { method: 'POST' })
      addToast({ type: 'success', title: 'Neuer Link erzeugt', message: 'Der alte Link funktioniert nicht mehr.' })
      await onChanged()
    } catch (cause) {
      addToast({ type: 'error', title: 'Link nicht erneuert', message: cause instanceof Error ? cause.message : undefined })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#343434]/60 bg-[#181818]/55 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-white">{party.name}{party.role ? <span className="font-normal text-[#909090]"> · {party.role}</span> : null}</p>
        <p className="mt-0.5 truncate text-[11px] text-[#808080]">{state}</p>
      </div>
      <input readOnly value={url} onFocus={(event) => event.target.select()} className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#343434] bg-[#141414] px-2 text-[11.5px] text-[#a6a6a6]" />
      <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Kopiert' : 'Link'}</Button>
      {canManage && canRegenerate && !party.signedAt && !party.declinedAt && (
        <Button size="sm" variant="ghost" loading={loading} onClick={regenerate} aria-label="Link neu erzeugen"><RefreshCw size={13} /></Button>
      )}
    </div>
  )
}

export function AgreementsWorkspace({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<'agreements' | 'templates'>('agreements')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ kind: 'agreement' | 'template'; id: string | null; draft: AgreementDraft } | null>(null)
  const { execute, loading: saving } = useApi()
  const { addToast } = useToast()

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (status) params.set('status', status)
    return `/api/agreements${params.size ? `?${params}` : ''}`
  }, [search, status])

  const { data: rows, loading, refetch } = useFetch<ListRow[]>(query)
  const { data: templates, refetch: refetchTemplates } = useFetch<AgreementTemplateRow[]>('/api/agreement-templates')
  const { data: detail, refetch: refetchDetail } = useFetch<DetailRow>(selectedId ? `/api/agreements/${selectedId}` : null)

  const fail = (title: string, cause: unknown) => addToast({ type: 'error', title, message: cause instanceof Error ? cause.message : undefined })
  const refreshAll = async () => { await Promise.all([refetch(), selectedId ? refetchDetail() : null]) }

  const save = async (draft: AgreementDraft, templateName: string | null) => {
    if (!editor) return
    try {
      if (editor.kind === 'template') {
        const body = { name: draft.title.trim(), letterhead: draft.letterhead, content: draft.content, clauses: clausePayload(draft), closing: draft.closing || null }
        await execute(editor.id ? `/api/agreement-templates/${editor.id}` : '/api/agreement-templates', { method: editor.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
        addToast({ type: 'success', title: 'Vorlage gespeichert' })
        await refetchTemplates()
      } else {
        const body = {
          title: draft.title.trim(),
          letterhead: draft.letterhead,
          content: draft.content,
          clauses: clausePayload(draft),
          closing: draft.closing || null,
          templateId: draft.templateId || null,
          parties: draft.parties.filter((party) => party.name.trim()).map((party) => ({ ...(party.id ? { id: party.id } : {}), name: party.name.trim(), role: party.role.trim() || null })),
        }
        await execute(editor.id ? `/api/agreements/${editor.id}` : '/api/agreements', { method: editor.id ? 'PATCH' : 'POST', body: JSON.stringify(body) })
        if (templateName) {
          // Scheitert das Sichern der Vorlage, bleibt der Vertrag trotzdem gespeichert.
          try {
            await execute('/api/agreement-templates', { method: 'POST', body: JSON.stringify({ name: templateName.slice(0, 120), letterhead: body.letterhead, content: body.content, clauses: body.clauses, closing: body.closing }) })
            await refetchTemplates()
          } catch (cause) {
            fail('Vorlage nicht gesichert', cause)
          }
        }
        addToast({ type: 'success', title: 'Vertrag gespeichert' })
        await refreshAll()
      }
      setEditor(null)
    } catch (cause) {
      fail('Speichern fehlgeschlagen', cause)
    }
  }

  const action = async (path: string, method: 'POST' | 'DELETE', title: string, closeDetail = false) => {
    if (!selectedId) return
    try {
      await execute(`/api/agreements/${selectedId}${path}`, { method })
      addToast({ type: 'success', title })
      if (closeDetail) setSelectedId(null)
      await refreshAll()
    } catch (cause) {
      fail('Aktion fehlgeschlagen', cause)
    }
  }

  const deleteTemplate = async (id: string) => {
    try {
      await execute(`/api/agreement-templates/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Vorlage gelöscht' })
      await refetchTemplates()
    } catch (cause) {
      fail('Löschen fehlgeschlagen', cause)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['agreements', 'templates'] as const).map((entry) => (
          <button key={entry} type="button" onClick={() => setTab(entry)}
            className={cn('inline-flex h-9 items-center rounded-[9px] border px-3 text-[12.5px] font-semibold', tab === entry ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]' : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:text-white')}>
            {entry === 'agreements' ? 'Verträge' : 'Vorlagen'}
          </button>
        ))}
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setEditor(tab === 'agreements' ? { kind: 'agreement', id: null, draft: emptyDraft() } : { kind: 'template', id: null, draft: { ...emptyDraft(), parties: [] } })}>
            <Plus size={14} /> {tab === 'agreements' ? 'Neuer Vertrag' : 'Neue Vorlage'}
          </Button>
        )}
      </div>

      {tab === 'agreements' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
            <Input placeholder="Titel oder Partei suchen" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Select options={[{ value: '', label: 'Alle Status' }, ...AGREEMENT_STATUSES.map((value) => ({ value, label: AGREEMENT_STATUS_META[value].label }))]} value={status} onValueChange={setStatus} />
          </div>
          {loading && !rows ? <PageLoader /> : !rows?.length ? (
            <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 px-4 py-10 text-center">
              <FileSignature size={20} className="mx-auto text-[#6a6a6a]" />
              <p className="mt-2 text-[13px] text-[#d4d4d4]">Keine Verträge gefunden</p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {rows.map((row) => {
                const signedCount = row.parties.filter((party) => party.signedAt).length
                return (
                  <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5 text-left hover:border-[#404040]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-semibold text-white">{row.title}</p>
                      <Badge variant={AGREEMENT_STATUS_META[row.status].variant}>{AGREEMENT_STATUS_META[row.status].label}</Badge>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-[#a6a6a6]">{row.parties.map((party) => party.name).join(' · ')}</p>
                    <p className="mt-1 text-[11.5px] text-[#6a6a6a]">{signedCount} von {row.parties.length} unterschrieben · {formatDateTime(row.updatedAt)}</p>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {(templates ?? []).map((template) => (
            <div key={template.id} className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5">
              <p className="text-[14px] font-semibold text-white">{template.name}</p>
              <p className="mt-1 text-[12px] text-[#808080]">{readContractClauses(template.clauses).length} Regelungen · Briefkopf {template.letterhead === 'FIB' ? 'FIB' : 'neutral'}</p>
              {canManage && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditor({ kind: 'template', id: template.id, draft: templateDraft(template) })}>Bearbeiten</Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteTemplate(template.id)}>Löschen</Button>
                </div>
              )}
            </div>
          ))}
          {!templates?.length && <p className="text-[13px] text-[#808080]">Noch keine Vorlagen.</p>}
        </div>
      )}

      <Modal open={!!selectedId && !editor} onClose={() => setSelectedId(null)} title={detail?.title ?? 'Vertrag'} description={detail ? AGREEMENT_STATUS_META[detail.status].label : undefined} size="xl">
        {!detail ? <PageLoader /> : (
          <div className="space-y-4">
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {detail.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => setEditor({ kind: 'agreement', id: detail.id, draft: draftFrom(detail) })}>Bearbeiten</Button>}
                {detail.status === 'DRAFT' && <Button size="sm" loading={saving} onClick={() => action('/release', 'POST', 'Vertrag freigegeben')}>Freigeben</Button>}
                {(detail.status === 'DRAFT' || detail.status === 'OPEN') && <Button size="sm" variant="ghost" loading={saving} onClick={() => action('/cancel', 'POST', 'Vertrag zurückgezogen')}>Zurückziehen</Button>}
                <Button size="sm" variant="ghost" loading={saving} onClick={() => action('/duplicate', 'POST', 'Kopie als Entwurf angelegt', true)}>Duplizieren</Button>
                {detail.status === 'DRAFT' && <Button size="sm" variant="danger" loading={saving} onClick={() => action('', 'DELETE', 'Entwurf gelöscht', true)}>Löschen</Button>}
              </div>
            )}
            {detail.status === 'DRAFT' ? (
              <p className="text-[12px] text-[#a6a6a6]">Die Links funktionieren erst nach dem Freigeben.</p>
            ) : (
              <p className="text-[11px] text-[#c08a5a]">Wer einen Link besitzt, kann für diese Partei unterschreiben. Nur an die vorgesehene Stelle weitergeben.</p>
            )}
            <div className="space-y-2">
              {detail.parties.map((party) => (
                <LinkRow key={party.id} agreementId={detail.id} party={party} canManage={canManage} canRegenerate={detail.status === 'DRAFT' || detail.status === 'OPEN'} onChanged={refetchDetail} />
              ))}
            </div>
            <AgreementDocument document={{ ...detail, clauses: readContractClauses(detail.clauses) }} />
          </div>
        )}
      </Modal>

      <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.kind === 'template' ? (editor.id ? 'Vorlage bearbeiten' : 'Neue Vorlage') : editor?.id ? 'Vertrag bearbeiten' : 'Neuer Vertrag'} size="xl">
        {editor && (
          <AgreementEditor key={editor.id ?? 'new'} mode={editor.kind} initial={editor.draft} templates={templates ?? []} saving={saving} onSave={save} onCancel={() => setEditor(null)} />
        )}
      </Modal>
    </div>
  )
}
