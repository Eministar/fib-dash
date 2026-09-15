'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { readContractClauses } from '@/lib/contracts'
import type { AgreementLetterhead } from '@/lib/agreements'

export interface AgreementTemplateRow {
  id: string
  name: string
  letterhead: AgreementLetterhead
  content: string
  clauses: unknown
  closing: string | null
}

export interface AgreementDraft {
  title: string
  letterhead: AgreementLetterhead
  content: string
  closing: string
  templateId: string
  clauses: { key: string; title: string; body: string }[]
  parties: { key: string; id?: string; name: string; role: string }[]
}

const key = () => Math.random().toString(36).slice(2, 10)

export function emptyDraft(): AgreementDraft {
  return {
    title: '',
    letterhead: 'FIB',
    content: '',
    closing: '',
    templateId: '',
    clauses: [{ key: key(), title: '', body: '' }],
    parties: [{ key: key(), name: '', role: '' }, { key: key(), name: '', role: '' }],
  }
}

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function AgreementEditor({
  mode,
  initial,
  templates,
  saving,
  onSave,
  onCancel,
}: {
  mode: 'agreement' | 'template'
  initial: AgreementDraft
  templates: AgreementTemplateRow[]
  saving: boolean
  onSave: (draft: AgreementDraft, templateName: string | null) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const set = (patch: Partial<AgreementDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const applyTemplate = (templateId: string) => {
    const template = templates.find((entry) => entry.id === templateId)
    if (!template) return set({ templateId: '' })
    const clauses = readContractClauses(template.clauses)
    set({
      templateId,
      letterhead: template.letterhead,
      content: template.content,
      closing: template.closing ?? '',
      clauses: clauses.length ? clauses.map((clause) => ({ key: key(), title: clause.title, body: clause.body })) : [{ key: key(), title: '', body: '' }],
    })
  }

  return (
    <div className="space-y-4">
      {mode === 'agreement' && templates.length > 0 && (
        <Select
          label="Von Vorlage übernehmen"
          options={[{ value: '', label: 'Leeres Dokument' }, ...templates.map((template) => ({ value: template.id, label: template.name }))]}
          value={draft.templateId}
          onValueChange={applyTemplate}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={mode === 'agreement' ? 'Titel' : 'Name der Vorlage'} value={draft.title} maxLength={mode === 'agreement' ? 200 : 120} onChange={(event) => set({ title: event.target.value })} />
        <Select
          label="Briefkopf"
          options={[{ value: 'FIB', label: 'FIB (Wappen & Stempel)' }, { value: 'NEUTRAL', label: 'Neutral' }]}
          value={draft.letterhead}
          onValueChange={(value) => set({ letterhead: value as AgreementLetterhead })}
        />
      </div>

      {mode === 'agreement' && (
        <div className="space-y-2">
          <p className="text-[12.5px] font-semibold text-[#d4d4d4]">Parteien</p>
          {draft.parties.map((party, index) => (
            <div key={party.key} className="flex items-end gap-2">
              <Input label={`Partei ${index + 1}`} value={party.name} maxLength={200} placeholder="z. B. Los Santos Police Department"
                onChange={(event) => set({ parties: draft.parties.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) })} />
              <Input label="Vertreten durch / Funktion" value={party.role} maxLength={200} placeholder="optional"
                onChange={(event) => set({ parties: draft.parties.map((entry, i) => (i === index ? { ...entry, role: event.target.value } : entry)) })} />
              {draft.parties.length > 1 && (
                <button type="button" aria-label={`Partei ${index + 1} entfernen`} className="mb-2 text-[#909090] hover:text-red-300"
                  onClick={() => set({ parties: draft.parties.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set({ parties: [...draft.parties, { key: key(), name: '', role: '' }] })}>
            <Plus size={13} /> Partei hinzufügen
          </Button>
        </div>
      )}

      <Textarea label="Präambel" rows={4} value={draft.content} placeholder="Einleitender Text (Markdown erlaubt)" onChange={(event) => set({ content: event.target.value })} />

      <div className="space-y-2">
        <p className="text-[12.5px] font-semibold text-[#d4d4d4]">Regelungen</p>
        {draft.clauses.map((clause, index) => (
          <div key={clause.key} className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-[#808080]">§ {index + 1}</span>
              <Input value={clause.title} maxLength={200} placeholder="Überschrift"
                onChange={(event) => set({ clauses: draft.clauses.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)) })} />
              <button type="button" aria-label="Nach oben" className="text-[#909090] hover:text-white" onClick={() => set({ clauses: move(draft.clauses, index, index - 1) })}><ArrowUp size={14} /></button>
              <button type="button" aria-label="Nach unten" className="text-[#909090] hover:text-white" onClick={() => set({ clauses: move(draft.clauses, index, index + 1) })}><ArrowDown size={14} /></button>
              {draft.clauses.length > 1 && (
                <button type="button" aria-label={`Regelung ${index + 1} entfernen`} className="text-[#909090] hover:text-red-300" onClick={() => set({ clauses: draft.clauses.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
              )}
            </div>
            <Textarea rows={3} value={clause.body} placeholder="Inhalt der Regelung"
              onChange={(event) => set({ clauses: draft.clauses.map((entry, i) => (i === index ? { ...entry, body: event.target.value } : entry)) })} />
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => set({ clauses: [...draft.clauses, { key: key(), title: '', body: '' }] })}>
          <Plus size={13} /> Regelung hinzufügen
        </Button>
      </div>

      <Textarea label="Abschluss" rows={3} value={draft.closing} placeholder="Text unterhalb der Regelungen" onChange={(event) => set({ closing: event.target.value })} />

      {mode === 'agreement' && (
        <div className="space-y-2 rounded-[10px] border border-[#343434]/60 p-3">
          <Checkbox checked={saveAsTemplate} onCheckedChange={setSaveAsTemplate} label="Aufbau zusätzlich als Vorlage sichern" />
          {saveAsTemplate && <Input label="Name der Vorlage" value={templateName} maxLength={120} placeholder="Ohne Angabe: Vertragstitel" onChange={(event) => setTemplateName(event.target.value)} />}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>Abbrechen</Button>
        <Button loading={saving} onClick={() => onSave(draft, saveAsTemplate ? templateName.trim() || draft.title.trim() : null)}>Speichern</Button>
      </div>
    </div>
  )
}
