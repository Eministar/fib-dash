'use client'

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Eye, PencilLine, Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ContractDocument } from '@/components/contracts/contract-document'
import {
  CONTRACT_FIELD_TYPES,
  CONTRACT_FIELD_TYPE_LABELS,
  CONTRACT_PLACE,
  contractPlaceholderHelp,
  type ContractClause,
  type ContractField,
  type ContractFieldTypeValue,
} from '@/lib/contracts'

export interface ContractTemplateForm {
  name: string
  description: string
  content: string
  clauses: ContractClause[]
  closing: string
  fields: ContractField[]
  active: boolean
  isDefault: boolean
}

type ViewMode = 'edit' | 'preview'

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function move<T>(items: T[], index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function ContractTemplateEditor({
  open,
  isEditing,
  form,
  onChange,
  saving,
  onSave,
  onClose,
}: {
  open: boolean
  isEditing: boolean
  form: ContractTemplateForm
  onChange: (patch: Partial<ContractTemplateForm>) => void
  saving: boolean
  onSave: () => void
  onClose: () => void
}) {
  const [view, setView] = useState<ViewMode>('edit')

  // Die Vorschau zeigt die Vorlage mit Beispiel-Agent, damit sofort sichtbar
  // ist, wie das fertige Dokument beim Mitarbeiter ankommt.
  const previewDocument = useMemo(
    () => ({
      title: form.name || 'Arbeitsvertrag',
      status: 'SENT' as const,
      content: form.content,
      closing: form.closing,
      clauses: form.clauses,
      place: CONTRACT_PLACE,
      documentDate: new Date().toISOString(),
      signedAt: null,
      signedName: null,
      agent: {
        firstName: 'Max',
        lastName: 'Mustermann',
        badgeNumber: '1234',
        rankName: 'Agent',
        hireDate: new Date().toISOString(),
      },
    }),
    [form.clauses, form.closing, form.content, form.name],
  )

  const updateClause = (index: number, patch: Partial<ContractClause>) => {
    onChange({
      clauses: form.clauses.map((clause, idx) => (idx === index ? { ...clause, ...patch } : clause)),
    })
  }

  const updateField = (index: number, patch: Partial<ContractField>) => {
    onChange({
      fields: form.fields.map((field, idx) => (idx === index ? { ...field, ...patch } : field)),
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 bg-[#080808]/70 backdrop-blur-[2px]"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(1100px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-[#373737]/60 bg-[#181818] shadow-2xl"
              >
                <header className="flex items-center justify-between gap-3 border-b border-[#343434]/50 px-4 py-3">
                  <Dialog.Title className="text-[15px] font-semibold text-white">
                    {isEditing ? 'Vertragsvorlage bearbeiten' : 'Neue Vertragsvorlage'}
                  </Dialog.Title>
                  <div className="flex items-center gap-1.5">
                    <ViewToggle view={view} onChange={setView} />
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-[8px] p-1.5 text-[#a6a6a6] transition-colors hover:bg-[#232323] hover:text-white"
                        aria-label="Schließen"
                      >
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {view === 'preview' ? (
                    <ContractDocument document={previewDocument} />
                  ) : (
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input
                          label="Name der Vorlage"
                          value={form.name}
                          onChange={(event) => onChange({ name: event.target.value })}
                          placeholder="Arbeitsvertrag"
                        />
                        <Input
                          label="Interne Beschreibung"
                          value={form.description}
                          onChange={(event) => onChange({ description: event.target.value })}
                          placeholder="Wofür wird diese Vorlage genutzt?"
                        />
                      </div>

                      <div className="flex flex-wrap gap-4">
                        <Checkbox
                          checked={form.active}
                          onCheckedChange={(checked) => onChange({ active: checked === true })}
                          label="Aktiv"
                        />
                        <Checkbox
                          checked={form.isDefault}
                          onCheckedChange={(checked) => onChange({ isDefault: checked === true })}
                          label="Standard beim Einstellen neuer Agent"
                        />
                      </div>

                      <PlaceholderHelp />

                      <Textarea
                        label="Präambel (über den Regelungen)"
                        value={form.content}
                        onChange={(event) => onChange({ content: event.target.value })}
                        rows={6}
                        className="font-mono text-[12.5px]"
                      />

                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <h3 className="text-[13.5px] font-semibold text-white">Regelungen</h3>
                            <p className="text-[11.5px] text-[#a6a6a6]">
                              Werden im Dokument automatisch als § 1, § 2, … nummeriert.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onChange({
                                clauses: [
                                  ...form.clauses,
                                  {
                                    id: newId('regelung'),
                                    title: 'Neue Regelung',
                                    body: '',
                                    sortOrder: form.clauses.length,
                                  },
                                ],
                              })
                            }
                          >
                            <Plus size={13} />
                            Regelung
                          </Button>
                        </div>

                        <div className="space-y-2.5">
                          {form.clauses.length === 0 && (
                            <p className="rounded-[10px] border border-dashed border-[#404040]/60 px-3 py-6 text-center text-[12.5px] text-[#909090]">
                              Noch keine Regelungen — füge die erste hinzu.
                            </p>
                          )}
                          {form.clauses.map((clause, index) => (
                            <div
                              key={clause.id}
                              className="rounded-[12px] border border-[#343434]/55 bg-[#181818]/45 p-3"
                            >
                              <div className="mb-2 flex items-center gap-2">
                                <span className="shrink-0 rounded-[6px] bg-[#232323] px-2 py-1 text-[11px] font-semibold text-[#d4d4d4]">
                                  § {index + 1}
                                </span>
                                <input
                                  value={clause.title}
                                  onChange={(event) => updateClause(index, { title: event.target.value })}
                                  placeholder="Überschrift der Regelung"
                                  className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-[#343434]/70 bg-[#181818]/60 px-2.5 text-[13px] text-[#f4f4f4] outline-none focus:border-[#d4d4d4]"
                                />
                                <RowActions
                                  onUp={() => onChange({ clauses: move(form.clauses, index, -1) })}
                                  onDown={() => onChange({ clauses: move(form.clauses, index, 1) })}
                                  onDelete={() =>
                                    onChange({ clauses: form.clauses.filter((_, idx) => idx !== index) })
                                  }
                                />
                              </div>
                              <textarea
                                value={clause.body}
                                onChange={(event) => updateClause(index, { body: event.target.value })}
                                rows={4}
                                placeholder="Text der Regelung (Markdown erlaubt)"
                                className="w-full resize-none rounded-[8px] border border-[#343434]/70 bg-[#181818]/60 px-2.5 py-2 font-mono text-[12.5px] text-[#f4f4f4] outline-none focus:border-[#d4d4d4]"
                              />
                            </div>
                          ))}
                        </div>
                      </section>

                      <Textarea
                        label="Schlusstext (unter den Regelungen)"
                        value={form.closing}
                        onChange={(event) => onChange({ closing: event.target.value })}
                        rows={4}
                        className="font-mono text-[12.5px]"
                      />

                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <h3 className="text-[13.5px] font-semibold text-white">
                              Felder für den Mitarbeiter
                            </h3>
                            <p className="text-[11.5px] text-[#a6a6a6]">
                              Was der Unterzeichner im Dokument ausfüllt. Unterschriftsfelder sind
                              immer Pflicht.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onChange({
                                fields: [
                                  ...form.fields,
                                  {
                                    id: newId('feld'),
                                    type: 'SHORT_TEXT',
                                    label: 'Neues Feld',
                                    description: null,
                                    placeholder: null,
                                    required: true,
                                    sortOrder: form.fields.length,
                                  },
                                ],
                              })
                            }
                          >
                            <Plus size={13} />
                            Feld
                          </Button>
                        </div>

                        <div className="space-y-2.5">
                          {form.fields.map((field, index) => (
                            <div
                              key={field.id}
                              className="rounded-[12px] border border-[#343434]/55 bg-[#181818]/45 p-3"
                            >
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="min-w-[180px] flex-1">
                                  <Input
                                    label="Bezeichnung"
                                    value={field.label}
                                    onChange={(event) => updateField(index, { label: event.target.value })}
                                  />
                                </div>
                                <div className="w-[190px]">
                                  <Select
                                    label="Typ"
                                    value={field.type}
                                    onValueChange={(value) =>
                                      updateField(index, { type: value as ContractFieldTypeValue })
                                    }
                                    options={CONTRACT_FIELD_TYPES.map((type) => ({
                                      value: type,
                                      label: CONTRACT_FIELD_TYPE_LABELS[type],
                                    }))}
                                  />
                                </div>
                                <div className="pb-2">
                                  <Checkbox
                                    checked={field.type === 'SIGNATURE' ? true : field.required}
                                    disabled={field.type === 'SIGNATURE'}
                                    onCheckedChange={(checked) =>
                                      updateField(index, { required: checked === true })
                                    }
                                    label="Pflicht"
                                  />
                                </div>
                                <div className="pb-1">
                                  <RowActions
                                    onUp={() => onChange({ fields: move(form.fields, index, -1) })}
                                    onDown={() => onChange({ fields: move(form.fields, index, 1) })}
                                    onDelete={() =>
                                      onChange({ fields: form.fields.filter((_, idx) => idx !== index) })
                                    }
                                  />
                                </div>
                              </div>
                              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <Input
                                  label="Hinweistext"
                                  value={field.description ?? ''}
                                  onChange={(event) =>
                                    updateField(index, { description: event.target.value || null })
                                  }
                                  placeholder="Optional"
                                />
                                <Input
                                  label="Platzhalter im Eingabefeld"
                                  value={field.placeholder ?? ''}
                                  onChange={(event) =>
                                    updateField(index, { placeholder: event.target.value || null })
                                  }
                                  placeholder="Optional"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  )}
                </div>

                <footer className="flex justify-end gap-2 border-t border-[#343434]/50 px-4 py-3">
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Abbrechen
                  </Button>
                  <Button size="sm" onClick={onSave} loading={saving}>
                    <Save size={14} />
                    Speichern
                  </Button>
                </footer>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (view: ViewMode) => void }) {
  const modes: { key: ViewMode; label: string; icon: typeof PencilLine }[] = [
    { key: 'edit', label: 'Bearbeiten', icon: PencilLine },
    { key: 'preview', label: 'Vorschau', icon: Eye },
  ]
  return (
    <div className="flex gap-1 rounded-[8px] border border-[#343434]/60 p-0.5">
      {modes.map((mode) => {
        const Icon = mode.icon
        return (
          <button
            key={mode.key}
            type="button"
            onClick={() => onChange(mode.key)}
            className={
              view === mode.key
                ? 'inline-flex items-center gap-1.5 rounded-[6px] bg-[#d4d4d4]/15 px-2.5 py-1 text-[12px] font-semibold text-[#d4d4d4]'
                : 'inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] text-[#a6a6a6] hover:text-white'
            }
          >
            <Icon size={13} />
            {mode.label}
          </button>
        )
      })}
    </div>
  )
}

function RowActions({
  onUp,
  onDown,
  onDelete,
}: {
  onUp: () => void
  onDown: () => void
  onDelete: () => void
}) {
  const base =
    'rounded-[7px] border border-[#404040]/70 p-1.5 text-[#a6a6a6] transition-colors hover:text-white'
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" onClick={onUp} className={base} aria-label="Nach oben">
        <ChevronUp size={14} />
      </button>
      <button type="button" onClick={onDown} className={base} aria-label="Nach unten">
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className={`${base} hover:border-[#7f1d1d] hover:text-[#fca5a5]`}
        aria-label="Entfernen"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function PlaceholderHelp() {
  const items = contractPlaceholderHelp()
  return (
    <div className="rounded-[12px] border border-[#343434]/50 bg-[#181818]/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a6a6a6]">
        Platzhalter
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <span key={item.token} className="text-[11.5px] text-[#aeaeae]">
            <code className="rounded-[4px] bg-[#232323] px-1.5 py-0.5 font-mono text-[11px] text-[#d4d4d4]">
              {item.token}
            </code>{' '}
            {item.description}
          </span>
        ))}
      </div>
    </div>
  )
}
