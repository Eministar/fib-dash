'use client'

import { useMemo, useState } from 'react'
import { Building2, Check, Copy, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { CONTRACT_STATUS_META, type ContractStatusValue } from '@/lib/contracts'
import { cn } from '@/lib/utils'

export interface AgencySignatureRow {
  id: string
  side: string
  partyName: string
  partyRole: string | null
  sortOrder: number
  token: string
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
  declineReason: string | null
}

export interface AgencyContractRow {
  id: string
  title: string
  status: ContractStatusValue
  createdAt: string
  counterpartyName?: string | null
  counterpartyRole?: string | null
  signatures?: AgencySignatureRow[]
}

export interface TemplateOption {
  id: string
  name: string
  content: string
  clauses: unknown
  closing: string | null
  fields: unknown
}

interface ClauseDraft {
  id: string
  title: string
  body: string
}

const EMPTY_FORM = {
  title: '',
  ownPartyName: 'Federal Investigation Bureau',
  ownPartyRole: '',
  counterpartyName: '',
  counterpartyRole: '',
  content: '',
  closing: '',
  templateId: '',
  saveAsTemplate: false,
  templateName: '',
}

function newClause(): ClauseDraft {
  return { id: `c${Math.random().toString(36).slice(2, 10)}`, title: '', body: '' }
}

/** Nur das Unterschriftsfeld — mehr braucht ein Behördenvertrag nicht zwingend. */
const DEFAULT_FIELDS = [
  { id: 'sig', type: 'SIGNATURE', label: 'Unterschrift', required: true, sortOrder: 0 },
]

function LinkRow({ signature }: { signature: AgencySignatureRow }) {
  const [copied, setCopied] = useState(false)

  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/vertrag/${signature.token}`
  const state = signature.declinedAt ? 'Abgelehnt' : signature.signedAt ? 'Unterschrieben' : 'Offen'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ohne Zwischenablage-Recht bleibt der Link im Feld zum Markieren stehen.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#343434]/60 bg-[#181818]/55 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-white">
          {signature.partyName}
          {signature.partyRole ? <span className="font-normal text-[#909090]"> · {signature.partyRole}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#808080]">
          {state}
          {signature.signedName ? ` · ${signature.signedName}` : ''}
          {signature.declineReason ? ` · ${signature.declineReason}` : ''}
        </p>
      </div>
      <input
        readOnly
        value={url}
        onFocus={(event) => event.target.select()}
        className="h-8 min-w-0 flex-1 rounded-[8px] border border-[#343434] bg-[#141414] px-2 text-[11.5px] text-[#a6a6a6]"
      />
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Kopiert' : 'Link'}
      </Button>
    </div>
  )
}

export function AgencyContracts({
  contracts,
  templates,
  canManage,
  onChanged,
}: {
  contracts: AgencyContractRow[]
  templates: TemplateOption[]
  canManage: boolean
  onChanged: () => Promise<unknown> | void
}) {
  const { execute, loading } = useApi()
  const { addToast } = useToast()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [clauses, setClauses] = useState<ClauseDraft[]>([newClause()])

  const templateOptions = useMemo(
    () => [
      { value: '', label: 'Leeres Dokument' },
      ...templates.map((template) => ({ value: template.id, label: template.name })),
    ],
    [templates],
  )

  const reset = () => {
    setForm(EMPTY_FORM)
    setClauses([newClause()])
  }

  /** Eine Vorlage füllt das Formular vor — gebunden bleibt der Vertrag daran nicht. */
  const applyTemplate = (templateId: string) => {
    setForm((previous) => ({ ...previous, templateId }))
    const template = templates.find((entry) => entry.id === templateId)
    if (!template) return

    const templateClauses = Array.isArray(template.clauses)
      ? (template.clauses as { id?: string; title?: string; body?: string }[])
      : []
    setForm((previous) => ({
      ...previous,
      content: template.content ?? '',
      closing: template.closing ?? '',
    }))
    setClauses(
      templateClauses.length > 0
        ? templateClauses.map((clause, index) => ({
            id: clause.id ?? `c${index}`,
            title: clause.title ?? '',
            body: clause.body ?? '',
          }))
        : [newClause()],
    )
  }

  const submit = async () => {
    if (!form.title.trim()) return addToast({ type: 'error', title: 'Titel fehlt' })
    if (!form.counterpartyName.trim()) {
      return addToast({ type: 'error', title: 'Name der Gegenpartei fehlt' })
    }

    const filled = clauses
      .filter((clause) => clause.title.trim() || clause.body.trim())
      .map((clause, index) => ({
        id: clause.id,
        title: clause.title.trim(),
        body: clause.body.trim(),
        sortOrder: index,
      }))

    try {
      await execute('/api/contracts/agency', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          content: form.content,
          clauses: filled,
          closing: form.closing.trim() || null,
          fields: DEFAULT_FIELDS,
          templateId: form.templateId || null,
          ownPartyName: form.ownPartyName.trim(),
          ownPartyRole: form.ownPartyRole.trim() || null,
          counterpartyName: form.counterpartyName.trim(),
          counterpartyRole: form.counterpartyRole.trim() || null,
        }),
      })

      if (form.saveAsTemplate) {
        // Scheitert das Sichern, ist der Vertrag trotzdem angelegt — deshalb
        // getrennt gemeldet statt den ganzen Vorgang scheitern zu lassen.
        try {
          await execute('/api/contract-templates', {
            method: 'POST',
            body: JSON.stringify({
              name: form.templateName.trim() || form.title.trim(),
              content: form.content,
              clauses: filled,
              closing: form.closing.trim() || null,
              fields: DEFAULT_FIELDS,
            }),
          })
        } catch (cause) {
          addToast({
            type: 'error',
            title: 'Vorlage nicht gesichert',
            message: cause instanceof Error ? cause.message : undefined,
          })
        }
      }

      addToast({ type: 'success', title: 'Behördenvertrag angelegt' })
      setOpen(false)
      reset()
      await onChanged()
    } catch (cause) {
      addToast({
        type: 'error',
        title: 'Anlegen fehlgeschlagen',
        message: cause instanceof Error ? cause.message : undefined,
      })
    }
  }

  return (
    <section className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} />
            Neuer Behördenvertrag
          </Button>
        </div>
      )}

      {contracts.length === 0 ? (
        <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 px-4 py-10 text-center">
          <Building2 size={20} className="mx-auto text-[#6a6a6a]" />
          <p className="mt-2 text-[13px] text-[#d4d4d4]">Noch keine Behördenverträge</p>
          <p className="mt-1 text-[11.5px] text-[#808080]">
            Vereinbarungen mit anderen Behörden werden hier aufgesetzt und über je einen Link
            unterschrieben.
          </p>
        </div>
      ) : (
        contracts.map((contract) => {
          const meta = CONTRACT_STATUS_META[contract.status]
          return (
            <div
              key={contract.id}
              className="space-y-2 rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-white">{contract.title}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-[#909090]">
                    mit {contract.counterpartyName || '—'}
                    {contract.counterpartyRole ? ` · ${contract.counterpartyRole}` : ''}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold',
                    'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6]',
                  )}
                >
                  {meta.label}
                </span>
              </div>

              <div className="space-y-2">
                {(contract.signatures ?? [])
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((signature) => (
                    <LinkRow key={signature.id} signature={signature} />
                  ))}
              </div>

              <p className="text-[11px] text-[#c08a5a]">
                Wer den Link besitzt, kann für seine Seite unterschreiben. Nur an die vorgesehene
                Stelle weitergeben.
              </p>
            </div>
          )
        })
      )}

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          reset()
        }}
        title="Neuer Behördenvertrag"
        description="Frei aufsetzbar. Beide Seiten unterschreiben anschließend über je einen eigenen Link."
        size="xl"
      >
        <div className="space-y-4">
          <Select
            label="Von Vorlage übernehmen"
            options={templateOptions}
            value={form.templateId}
            onValueChange={applyTemplate}
          />

          <Input
            label="Titel"
            value={form.title}
            maxLength={200}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            placeholder="z. B. Kooperationsvereinbarung Zeugenschutz"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Eigene Vertretung"
              value={form.ownPartyName}
              maxLength={200}
              onChange={(event) => setForm((f) => ({ ...f, ownPartyName: event.target.value }))}
            />
            <Input
              label="Funktion (eigene Seite)"
              value={form.ownPartyRole}
              maxLength={200}
              onChange={(event) => setForm((f) => ({ ...f, ownPartyRole: event.target.value }))}
              placeholder="z. B. Direktor"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Behörde der Gegenpartei"
              value={form.counterpartyName}
              maxLength={200}
              onChange={(event) => setForm((f) => ({ ...f, counterpartyName: event.target.value }))}
              placeholder="z. B. Los Santos Police Department"
            />
            <Input
              label="Funktion (Gegenpartei)"
              value={form.counterpartyRole}
              maxLength={200}
              onChange={(event) => setForm((f) => ({ ...f, counterpartyRole: event.target.value }))}
              placeholder="z. B. Chief of Police"
            />
          </div>

          <Textarea
            label="Präambel"
            value={form.content}
            rows={4}
            onChange={(event) => setForm((f) => ({ ...f, content: event.target.value }))}
            placeholder="Einleitender Text oberhalb der Regelungen (Markdown erlaubt)"
          />

          <div className="space-y-2">
            <p className="text-[12.5px] font-semibold text-[#d4d4d4]">Regelungen</p>
            {clauses.map((clause, index) => (
              <div key={clause.id} className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[#808080]">§ {index + 1}</span>
                  <Input
                    value={clause.title}
                    maxLength={200}
                    onChange={(event) =>
                      setClauses((list) =>
                        list.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)),
                      )
                    }
                    placeholder="Überschrift"
                  />
                  {clauses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setClauses((list) => list.filter((_, i) => i !== index))}
                      className="text-[#909090] hover:text-red-300"
                      aria-label={`Regelung ${index + 1} entfernen`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <Textarea
                  value={clause.body}
                  rows={3}
                  onChange={(event) =>
                    setClauses((list) =>
                      list.map((entry, i) => (i === index ? { ...entry, body: event.target.value } : entry)),
                    )
                  }
                  placeholder="Inhalt der Regelung"
                />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setClauses((list) => [...list, newClause()])}>
              <Plus size={13} />
              Regelung hinzufügen
            </Button>
          </div>

          <Textarea
            label="Abschluss"
            value={form.closing}
            rows={3}
            onChange={(event) => setForm((f) => ({ ...f, closing: event.target.value }))}
            placeholder="Text unterhalb der Regelungen"
          />

          <div className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
            <Checkbox
              checked={form.saveAsTemplate}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, saveAsTemplate: checked === true }))}
              label="Diesen Aufbau zusätzlich als Vorlage sichern"
            />
            {form.saveAsTemplate && (
              <Input
                label="Name der Vorlage"
                value={form.templateName}
                maxLength={120}
                onChange={(event) => setForm((f) => ({ ...f, templateName: event.target.value }))}
                placeholder="Ohne Angabe wird der Vertragstitel verwendet"
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Abbrechen
            </Button>
            <Button loading={loading} onClick={submit}>
              Vertrag anlegen
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
