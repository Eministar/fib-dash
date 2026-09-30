'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ClipboardPaste, ExternalLink, FileText, Globe, Lock, Plus, Table2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import { renderMarkdown } from '@/lib/markdown'
import {
  MAX_TABLE_COLUMNS,
  PUBLICATION_STATUS,
  SLUG_PATTERN,
  parsePastedTable,
  type PublicationAccess,
  type PublicationKind,
  type PublicationStatus,
  type PublicationTable,
} from '@/lib/publications'
import { cn } from '@/lib/utils'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'
import { useDraft } from '@/hooks/use-draft'
import { ListSkeleton } from '@/components/ui/loading'

export interface PublicationRecord {
  id: string
  slug: string
  kind: PublicationKind
  title: string
  summary: string | null
  content: string
  table: PublicationTable | null
  status: PublicationStatus
  access: PublicationAccess
  roleIds: string[] | null
  listed: boolean
  pinned: boolean
}

const EMPTY_TABLE: PublicationTable = { columns: ['Name', 'Information'], rows: [['', '']] }

function TableEditor({ table, onChange }: { table: PublicationTable; onChange: (table: PublicationTable) => void }) {
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const setColumn = (index: number, value: string) => onChange({ ...table, columns: table.columns.map((column, i) => i === index ? value : column) })
  const setCell = (row: number, column: number, value: string) => onChange({
    ...table,
    rows: table.rows.map((cells, r) => r === row ? cells.map((cell, c) => c === column ? value : cell) : cells),
  })
  const addColumn = () => onChange({ columns: [...table.columns, `Spalte ${table.columns.length + 1}`], rows: table.rows.map((row) => [...row, '']) })
  const removeColumn = (index: number) => onChange({
    columns: table.columns.filter((_, i) => i !== index),
    rows: table.rows.map((row) => row.filter((_, i) => i !== index)),
  })
  const addRow = () => onChange({ ...table, rows: [...table.rows, table.columns.map(() => '')] })
  const removeRow = (index: number) => onChange({ ...table, rows: table.rows.filter((_, i) => i !== index) })

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-[#98989d]">Tabelle · {table.columns.length} Spalten · {table.rows.length} Zeilen</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setPasting(true)}><ClipboardPaste size={13} /> Aus Excel/Sheets einfügen</Button>
          <Button type="button" variant="secondary" size="sm" onClick={addColumn} disabled={table.columns.length >= MAX_TABLE_COLUMNS}><Plus size={13} /> Spalte</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-[#38383a]">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-[#1c1c1e]">
            <tr>
              {table.columns.map((column, index) => (
                <th key={index} className="min-w-[160px] border-b border-r border-[#38383a] p-1 last:border-r-0">
                  <div className="flex items-center gap-1">
                    <input
                      aria-label={`Überschrift Spalte ${index + 1}`}
                      value={column}
                      onChange={(event) => setColumn(index, event.target.value)}
                      className="h-8 w-full rounded-[6px] bg-transparent px-2 font-medium text-white outline-none focus:bg-[#2c2c2e]"
                    />
                    {table.columns.length > 1 && (
                      <button type="button" onClick={() => removeColumn(index)} aria-label={`Spalte ${column || index + 1} entfernen`} className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#8e8e93] hover:bg-[#3a3a3c] hover:text-[#ff6b6b]"><X size={13} /></button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-9 border-b border-[#38383a]" aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[#2c2c2e] last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-r border-[#2c2c2e] p-1 last-of-type:border-r-0">
                    <input
                      aria-label={`Zeile ${rowIndex + 1}, ${table.columns[cellIndex] || `Spalte ${cellIndex + 1}`}`}
                      value={cell}
                      onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                      className="h-8 w-full rounded-[6px] bg-transparent px-2 text-[#e5e5e5] outline-none focus:bg-[#2c2c2e]"
                    />
                  </td>
                ))}
                <td className="p-1">
                  <button type="button" onClick={() => removeRow(rowIndex)} aria-label={`Zeile ${rowIndex + 1} entfernen`} className="grid h-7 w-7 place-items-center rounded-[6px] text-[#8e8e93] hover:bg-[#3a3a3c] hover:text-[#ff6b6b]"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={addRow}><Plus size={13} /> Zeile hinzufügen</Button>

      <Modal open={pasting} onClose={() => setPasting(false)} title="Tabelle einfügen" description="In Excel oder Google Sheets markieren, kopieren und hier einfügen. Die erste Zeile wird zu den Spaltenüberschriften. CSV funktioniert auch." size="lg">
        <Textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={10} placeholder={'Name\tDienstgrad\tBemerkung\nMax Muster\tAgent\t…'} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPasting(false)}>Abbrechen</Button>
          <Button
            disabled={!pasteText.trim()}
            onClick={() => {
              const parsed = parsePastedTable(pasteText)
              if (parsed) onChange(parsed)
              setPasting(false)
              setPasteText('')
            }}
          >
            Übernehmen (ersetzt die Tabelle)
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function RolePicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: roles, loading, error } = useFetch<{ id: string; name: string }[]>('/api/publications/roles', 300_000)
  const [search, setSearch] = useState('')
  const visible = (roles ?? []).filter((role) => role.name.toLowerCase().includes(search.trim().toLowerCase()))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  const unknown = value.filter((id) => roles && !roles.some((role) => role.id === id))

  return (
    <div>
      <p className="mb-2 text-[12.5px] font-medium text-[#98989d]">Freigegebene Discord-Rollen · {value.length} ausgewählt</p>
      {error && <p role="alert" className="mb-2 text-[12px] text-[#fca5a5]">Rollen konnten nicht geladen werden: {error}</p>}
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Rolle suchen …"
        aria-label="Rolle suchen"
        className="mb-2 h-9 w-full rounded-[8px] border border-[#38383a] bg-[#161617] px-3 text-[13px] text-white outline-none focus:border-[#6f6f6f]"
      />
      <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-[10px] border border-[#38383a] p-1.5">
        {loading && !roles && <ListSkeleton compact />}
        {visible.map((role) => (
          <label key={role.id} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] text-[#e5e5e5] hover:bg-[#2c2c2e]">
            <input type="checkbox" checked={value.includes(role.id)} onChange={() => toggle(role.id)} className="accent-[#d4d4d4]" />
            {role.name}
          </label>
        ))}
        {roles && visible.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-[#8e8e93]">Keine Rolle gefunden.</p>}
      </div>
      {unknown.length > 0 && (
        <p className="mt-2 text-[12px] text-[#f5d38a]">
          {unknown.length} freigegebene Rolle(n) gibt es auf dem Discord-Server nicht mehr.{' '}
          <button type="button" className="underline" onClick={() => onChange(value.filter((id) => !unknown.includes(id)))}>Entfernen</button>
        </p>
      )}
    </div>
  )
}

export function PublicationEditor({ existing }: { existing?: PublicationRecord }) {
  const router = useRouter()
  const { execute, loading } = useApi<PublicationRecord>()
  const { addToast } = useToast()
  const [kind, setKind] = useState<PublicationKind>(existing?.kind ?? 'NOTICE')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [content, setContent] = useState(existing?.content ?? '')
  const [table, setTable] = useState<PublicationTable>(existing?.table ?? EMPTY_TABLE)
  const [status, setStatus] = useState<PublicationStatus>(existing?.status ?? 'DRAFT')
  const [listed, setListed] = useState(existing?.listed ?? true)
  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [access, setAccess] = useState<PublicationAccess>(existing?.access ?? 'PUBLIC')
  const [roleIds, setRoleIds] = useState<string[]>(existing?.roleIds ?? [])
  const slugInvalid = slug.trim() !== '' && !SLUG_PATTERN.test(slug.trim())
  const [pinned, setPinned] = useState(existing?.pinned ?? false)
  const [preview, setPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const previewHtml = useMemo(() => (preview ? renderMarkdown(content) : ''), [preview, content])
  const snapshot = JSON.stringify({ kind, title, summary, content, table, listed, slug, access, roleIds, pinned })
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot)
  useUnsavedChanges(snapshot !== savedSnapshot)
  const clearDraft = useDraft(
    `publication:${existing?.id ?? 'new'}`,
    { title, summary, content },
    (draft) => {
      setTitle(draft.title)
      setSummary(draft.summary)
      setContent(draft.content)
    },
    (draft) => !draft.title.trim() && !draft.content.trim(),
  )

  const save = async (nextStatus = status) => {
    try {
      const saved = await execute(`/api/publications${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify({ kind, title, summary, content, table: kind === 'TABLE' ? table : null, status: nextStatus, slug: slug.trim(), access, roleIds, listed, pinned }),
      })
      setStatus(nextStatus)
      setSavedSnapshot(snapshot)
      clearDraft()
      addToast({ type: 'success', title: nextStatus === 'PUBLISHED' ? 'Veröffentlicht' : 'Gespeichert' })
      if (!existing && saved) router.replace(`/publications/${saved.id}`)
      else router.refresh()
    } catch (err) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }

  const remove = async () => {
    if (!existing) return
    try {
      await execute(`/api/publications/${existing.id}`, { method: 'DELETE' })
      router.push('/publications')
    } catch (err) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }

  // Link zeigt auf den gespeicherten Namen – ein geänderter Link-Name gilt erst nach dem Speichern.
  const publicUrl = existing ? `/aushang/${existing.slug}` : null

  return (
    <div className="mx-auto max-w-5xl pb-10">
      <Link href="/publications" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-[#98989d] hover:text-white"><ArrowLeft size={14} /> Alle Aushänge</Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-white">{existing ? 'Aushang bearbeiten' : 'Neuer Aushang'}</h1>
          <p className="mt-1 text-[12.5px] text-[#8e8e93]">
            {status === 'PUBLISHED' ? 'Öffentlich sichtbar' : status === 'ARCHIVED' ? 'Archiviert – öffentlich nicht mehr erreichbar' : 'Entwurf – nur hier im Dashboard sichtbar'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {publicUrl && status === 'PUBLISHED' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${publicUrl}`); addToast({ type: 'success', title: 'Link kopiert' }) }}>Link kopieren</Button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-[32px] items-center gap-1.5 rounded-[8px] bg-[#2c2c2e] px-3 text-[12.5px] font-medium text-[#f5f5f7] hover:bg-[#3a3a3c]"><ExternalLink size={13} /> Ansehen</a>
            </>
          )}
          <Button variant="secondary" size="sm" loading={loading} disabled={slugInvalid} onClick={() => save()}>Speichern</Button>
          {status !== 'PUBLISHED' && <Button size="sm" loading={loading} disabled={slugInvalid} onClick={() => save('PUBLISHED')}>Veröffentlichen</Button>}
        </div>
      </div>

      <div className="space-y-5">
        <div className="glass-panel-elevated space-y-4 rounded-[14px] p-5">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Art des Aushangs">
            {([
              { id: 'NOTICE', label: 'Schreiben', text: 'Bekanntmachung oder Brief mit formatiertem Text.', icon: FileText },
              { id: 'TABLE', label: 'Tabelle', text: 'Liste mit Spalten, z. B. aus Excel oder Google Sheets.', icon: Table2 },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={kind === option.id}
                onClick={() => setKind(option.id)}
                className={cn('flex gap-3 rounded-[10px] border p-3 text-left transition-colors', kind === option.id ? 'border-[#98989d] bg-[#2c2c2e]' : 'border-[#38383a] hover:bg-[#1c1c1e]')}
              >
                <option.icon size={18} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
                <span><span className="block text-[13px] font-medium text-white">{option.label}</span><span className="mt-0.5 block text-[12px] text-[#8e8e93]">{option.text}</span></span>
              </button>
            ))}
          </div>
          <Input label="Titel" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="z. B. Bekanntmachung zur Dienstordnung" />
          <Input label="Kurzbeschreibung (optional)" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={500} placeholder="Erscheint auf dem Schwarzen Brett unter dem Titel" />
        </div>

        {kind === 'TABLE' && <div className="glass-panel-elevated rounded-[14px] p-5"><TableEditor table={table} onChange={setTable} /></div>}

        <div className="glass-panel-elevated rounded-[14px] p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-medium text-[#98989d]">{kind === 'TABLE' ? 'Einleitungstext (optional)' : 'Text'}</p>
            <div className="flex gap-1 rounded-[8px] bg-[#161617] p-0.5 text-[12px]">
              {[false, true].map((value) => (
                <button key={String(value)} type="button" aria-pressed={preview === value} onClick={() => setPreview(value)} className={cn('rounded-[6px] px-2.5 py-1', preview === value ? 'bg-[#3a3a3c] text-white' : 'text-[#8e8e93] hover:text-white')}>
                  {value ? 'Vorschau' : 'Bearbeiten'}
                </button>
              ))}
            </div>
          </div>
          {preview
            ? <article className="markdown-document min-h-[200px] rounded-[10px] border border-[#38383a] p-4" dangerouslySetInnerHTML={{ __html: previewHtml || '<p>Noch kein Text.</p>' }} />
            : <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={kind === 'TABLE' ? 5 : 16} maxLength={100_000} placeholder={'# Überschrift\n\nText des Schreibens. **Fett**, Listen mit - und Links sind möglich.'} />}
          <p className="mt-2 text-[11.5px] text-[#8e8e93]">Formatierung wie bei den Ordnungen: # Überschrift, **fett**, - Aufzählung.</p>
        </div>

        <div className="glass-panel-elevated space-y-4 rounded-[14px] p-5">
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[#98989d]">Wer darf den Aushang öffnen?</p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Zugriff">
              {([
                { id: 'PUBLIC', label: 'Alle mit Link', text: 'Ohne Anmeldung einsehbar.', icon: Globe },
                { id: 'ROLES', label: 'Nur bestimmte Discord-Rollen', text: 'Öffnen erst nach Discord-Anmeldung mit einer freigegebenen Rolle.', icon: Lock },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={access === option.id}
                  onClick={() => setAccess(option.id)}
                  className={cn('flex gap-3 rounded-[10px] border p-3 text-left transition-colors', access === option.id ? 'border-[#98989d] bg-[#2c2c2e]' : 'border-[#38383a] hover:bg-[#1c1c1e]')}
                >
                  <option.icon size={17} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
                  <span><span className="block text-[13px] font-medium text-white">{option.label}</span><span className="mt-0.5 block text-[12px] text-[#8e8e93]">{option.text}</span></span>
                </button>
              ))}
            </div>
          </div>
          {access === 'ROLES' && <RolePicker value={roleIds} onChange={setRoleIds} />}
          <div>
            <Input
              label="Link-Name (optional)"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
              maxLength={80}
              placeholder="z. B. dienstplan-oktober"
              error={slugInvalid ? '3–80 Zeichen, nur a–z, 0–9 und Bindestriche, nicht mit Bindestrich beginnen oder enden' : undefined}
            />
            <p className="mt-1.5 text-[11.5px] text-[#8e8e93]">
              Link: <code className="text-[#d4d4d4]">/aushang/{slug.trim() || (existing ? existing.slug : 'wird-automatisch-erzeugt')}</code>
              {existing && slug.trim() && slug.trim() !== existing.slug && ' · Achtung: Der bisherige Link funktioniert nach dem Speichern nicht mehr.'}
            </p>
          </div>
        </div>

        <div className="glass-panel-elevated grid gap-4 rounded-[14px] p-5 sm:grid-cols-3">
          <Select label="Status" value={status} onValueChange={(value) => setStatus(value as PublicationStatus)} options={Object.entries(PUBLICATION_STATUS).map(([value, label]) => ({ value, label }))} />
          <div className="pt-6"><Checkbox checked={listed} onCheckedChange={setListed} label="Auf dem Schwarzen Brett anzeigen" /></div>
          <div className="pt-6"><Checkbox checked={pinned} onCheckedChange={setPinned} label="Oben anheften" /></div>
          <p className="text-[11.5px] leading-5 text-[#8e8e93] sm:col-span-3">Ohne „Auf dem Schwarzen Brett anzeigen“ ist ein veröffentlichter Aushang nur über seinen Link erreichbar. Geschlossene Aushänge erscheinen auf dem Brett nur für Berechtigte. Entwürfe und Archiviertes sind öffentlich nie sichtbar.</p>
        </div>

        {existing && (
          <div className="flex justify-end">
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}><Trash2 size={13} /> Aushang löschen</Button>
          </div>
        )}
      </div>

      <Modal open={deleting} onClose={() => setDeleting(false)} title="Aushang löschen">
        <p className="mb-4 text-[13px] text-[#98989d]">„{existing?.title}“ endgültig löschen? Der öffentliche Link funktioniert danach nicht mehr.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(false)}>Abbrechen</Button>
          <Button variant="danger" loading={loading} onClick={remove}>Löschen</Button>
        </div>
      </Modal>
    </div>
  )
}
