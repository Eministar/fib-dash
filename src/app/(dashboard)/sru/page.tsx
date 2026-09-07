'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bold,
  CalendarDays,
  Code,
  Eye,
  FileText,
  Folder,
  FolderPlus,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  ListChecks,
  ListOrdered,
  ListTodo,
  List,
  Megaphone,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Save,
  SplitSquareHorizontal,
  Table,
  Trash2,
} from 'lucide-react'

import { TaskBoard } from '@/components/tasks/task-board'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { ColorField } from '@/components/ui/color-field'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn, formatDateTime } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import { renderMarkdown } from '@/lib/markdown'

type Tab = 'documents' | 'tasks' | 'calendar'

interface ConfirmDialogState {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

interface UserLite {
  id: string
  displayName: string
}

interface SruDocument {
  id: string
  folderId: string | null
  title: string
  content: string
  createdAt: string
  updatedAt: string
  createdBy: UserLite | null
  updatedBy: UserLite | null
}

interface SruFolder {
  id: string
  name: string
  description: string | null
  color: string
  documents: SruDocument[]
}

interface SruDocumentsPayload {
  folders: SruFolder[]
  looseDocuments: SruDocument[]
}

interface Agent {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
}

interface CalendarEvent {
  id: string
  title: string
  description: string | null
  type: string
  startsAt: string
  endsAt: string | null
  location: string | null
  discordAnnouncement: boolean
  agent: Agent | null
}

const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'documents', label: 'Dokumente', icon: FileText },
  { id: 'tasks', label: 'Aufgaben', icon: ListChecks },
  { id: 'calendar', label: 'Kalender', icon: CalendarDays },
]

const sruEventTypes = [
  { value: 'SRU_TRAINING', label: 'S.R.U.-Training' },
  { value: 'SRU_OPERATION', label: 'S.R.U.-Einsatz' },
  { value: 'MEETING', label: 'Besprechung' },
  { value: 'OTHER', label: 'Sonstiges' },
]

const FOLDER_COLOR_PRESETS = ['#d4d4d4', '#60a5fa', '#34d399', '#f87171', '#a78bfa', '#fbbf24', '#06b6d4', '#f97316']

const EMPTY_DOCUMENT = `# Neues S.R.U.-Dokument

## Überblick

- Punkt 1
- Punkt 2

## Maßnahmen

| Thema | Status | Notiz |
| --- | --- | --- |
| Vorbereitung | Offen |  |
`

function localDateTimeValue(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setMinutes(0, 0, 0)
  return date.toISOString().slice(0, 16)
}

function documentPreview(content: string) {
  const firstLine = content.split('\n').find((line) => line.trim())
  return firstLine?.trim() || 'Kein Inhalt'
}

function calendarTypeLabel(type: string) {
  const labels: Record<string, string> = {
    SRU_TRAINING: 'S.R.U.-Training',
    SRU_OPERATION: 'S.R.U.-Einsatz',
    MEETING: 'Besprechung',
    OTHER: 'Sonstiges',
  }
  return labels[type] ?? type
}

function SruDocuments({ canManage }: { canManage: boolean }) {
  const { data, loading, refetch } = useFetch<SruDocumentsPayload>('/api/sru/folders')
  const { execute } = useApi()
  const { addToast } = useToast()
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const loadedDocumentIdRef = useRef<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [folderId, setFolderId] = useState('')
  const [documentDirty, setDocumentDirty] = useState(false)
  const [writerMode, setWriterMode] = useState<'split' | 'preview'>('split')
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [docModalOpen, setDocModalOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [editingFolder, setEditingFolder] = useState<SruFolder | null>(null)
  const [folderForm, setFolderForm] = useState({ name: '', description: '', color: '#d4d4d4' })
  const [docForm, setDocForm] = useState({ title: '', folderId: '' })

  const allDocuments = useMemo(() => [
    ...(data?.looseDocuments ?? []),
    ...(data?.folders.flatMap((folder) => folder.documents) ?? []),
  ], [data])

  const selectedDocument = allDocuments.find((document) => document.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedDocument && allDocuments.length > 0) {
      setSelectedId(allDocuments[0].id)
    }
  }, [allDocuments, selectedDocument])

  useEffect(() => {
    if (!selectedDocument) {
      loadedDocumentIdRef.current = null
      setTitle('')
      setContent('')
      setFolderId('')
      setDocumentDirty(false)
      return
    }

    if (loadedDocumentIdRef.current === selectedDocument.id && documentDirty) return

    loadedDocumentIdRef.current = selectedDocument.id
    setTitle(selectedDocument.title)
    setContent(selectedDocument.content)
    setFolderId(selectedDocument.folderId ?? '')
    setDocumentDirty(false)
  }, [documentDirty, selectedDocument])

  const folderOptions = useMemo(() => [
    { value: '', label: 'Ohne Ordner' },
    ...(data?.folders ?? []).map((folder) => ({ value: folder.id, label: folder.name })),
  ], [data])

  const previewHtml = useMemo(() => renderMarkdown(content), [content])

  const applyMarkdown = (before: string, after = '', placeholder = 'Text') => {
    if (!canManage) return
    const editor = editorRef.current
    if (!editor) {
      setDocumentDirty(true)
      setContent((current) => `${current}${before}${placeholder}${after}`)
      return
    }
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = content.slice(start, end) || placeholder
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`
    setDocumentDirty(true)
    setContent(next)
    window.requestAnimationFrame(() => {
      editor.focus()
      editor.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  const insertBlock = (block: string) => {
    if (!canManage) return
    const editor = editorRef.current
    const insert = content && !content.endsWith('\n') ? `\n${block}` : block
    if (!editor) {
      setDocumentDirty(true)
      setContent((current) => `${current}${insert}`)
      return
    }
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const next = `${content.slice(0, start)}${insert}${content.slice(end)}`
    setDocumentDirty(true)
    setContent(next)
    window.requestAnimationFrame(() => {
      const cursor = start + insert.length
      editor.focus()
      editor.setSelectionRange(cursor, cursor)
    })
  }

  const openCreateFolder = () => {
    setEditingFolder(null)
    setFolderForm({ name: '', description: '', color: '#d4d4d4' })
    setFolderModalOpen(true)
  }

  const openEditFolder = (folder: SruFolder) => {
    setEditingFolder(folder)
    setFolderForm({
      name: folder.name,
      description: folder.description ?? '',
      color: folder.color || '#d4d4d4',
    })
    setFolderModalOpen(true)
  }

  const saveFolder = async () => {
    if (!folderForm.name.trim()) return
    try {
      if (editingFolder) {
        await execute('/api/sru/folders', {
          method: 'PATCH',
          body: JSON.stringify({
            id: editingFolder.id,
            name: folderForm.name,
            description: folderForm.description || null,
            color: folderForm.color,
          }),
        })
        addToast({ type: 'success', title: 'Ordner gespeichert' })
      } else {
        await execute('/api/sru/folders', {
          method: 'POST',
          body: JSON.stringify({
            name: folderForm.name,
            description: folderForm.description || null,
            color: folderForm.color,
          }),
        })
        addToast({ type: 'success', title: 'Ordner erstellt' })
      }
      setFolderModalOpen(false)
      setEditingFolder(null)
      setFolderForm({ name: '', description: '', color: '#d4d4d4' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Ordner konnte nicht gespeichert werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteFolder = async (id: string) => {
    try {
      await execute(`/api/sru/folders/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Ordner gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Ordner konnte nicht gelöscht werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const requestDeleteFolder = (folder: SruFolder) => {
    setConfirmDialog({
      title: 'Ordner löschen',
      message: `Der Ordner "${folder.name}" wird gelöscht. Enthaltene Dokumente bleiben erhalten und werden ohne Ordner abgelegt.`,
      confirmLabel: 'Ordner löschen',
      onConfirm: () => deleteFolder(folder.id),
    })
  }

  const createDocument = async () => {
    if (!docForm.title.trim()) return
    try {
      const created = await execute('/api/sru/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: docForm.title,
          folderId: docForm.folderId || null,
          content: EMPTY_DOCUMENT,
        }),
      }) as SruDocument | null
      addToast({ type: 'success', title: 'Dokument erstellt' })
      setDocModalOpen(false)
      setDocForm({ title: '', folderId: '' })
      setDocumentDirty(false)
      await refetch()
      if (created?.id) setSelectedId(created.id)
    } catch (err) {
      addToast({ type: 'error', title: 'Dokument konnte nicht erstellt werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const saveDocument = async () => {
    if (!selectedDocument || !title.trim()) return
    try {
      await execute(`/api/sru/documents/${selectedDocument.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title,
          content,
          folderId: folderId || null,
        }),
      })
      addToast({ type: 'success', title: 'Dokument gespeichert' })
      await refetch()
      setDocumentDirty(false)
    } catch (err) {
      addToast({ type: 'error', title: 'Dokument konnte nicht gespeichert werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteDocument = async () => {
    if (!selectedDocument) return
    try {
      await execute(`/api/sru/documents/${selectedDocument.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Dokument gelöscht' })
      setSelectedId(null)
      setDocumentDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Dokument konnte nicht gelöscht werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const requestDeleteDocument = () => {
    if (!selectedDocument) return
    setConfirmDialog({
      title: 'Dokument löschen',
      message: `Das Dokument "${selectedDocument.title}" wird dauerhaft gelöscht.`,
      confirmLabel: 'Dokument löschen',
      onConfirm: deleteDocument,
    })
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="S.R.U. Dokumente"
        description="Interne Dokumente, Ordner und Einsatznotizen der S.R.U."
        action={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={openCreateFolder}><FolderPlus size={13} /> Ordner</Button>
            <Button size="sm" onClick={() => setDocModalOpen(true)}><Plus size={13} /> Dokument</Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <aside className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#343434]/45 flex items-center justify-between">
            <p className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[#a6a6a6]">Ablage</p>
            <button type="button" onClick={refetch} className="p-1.5 rounded-[7px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/70">
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="max-h-[680px] overflow-y-auto p-2">
            {(data?.looseDocuments?.length ?? 0) > 0 && (
              <div className="mb-3">
                <p className="px-2 pb-1 text-[11px] text-[#909090]">Ohne Ordner</p>
                {data?.looseDocuments.map((document) => (
                  <DocumentButton key={document.id} document={document} active={selectedId === document.id} onClick={() => setSelectedId(document.id)} />
                ))}
              </div>
            )}
            {data?.folders.map((folder) => (
              <div key={folder.id} className="mb-3">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Folder size={13} style={{ color: folder.color }} />
                  <p className="flex-1 truncate text-[12.5px] font-semibold text-[#e5e5e5]">{folder.name}</p>
                  {canManage && (
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => openEditFolder(folder)} className="p-1 rounded text-[#686868] hover:text-[#d4d4d4]">
                        <Pencil size={11} />
                      </button>
                      <button type="button" onClick={() => requestDeleteFolder(folder)} className="p-1 rounded text-[#686868] hover:text-red-400">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>
                {folder.documents.length === 0 ? (
                  <p className="px-7 py-1 text-[11px] text-[#686868]">Keine Dokumente</p>
                ) : (
                  folder.documents.map((document) => (
                    <DocumentButton key={document.id} document={document} color={folder.color} active={selectedId === document.id} onClick={() => setSelectedId(document.id)} />
                  ))
                )}
              </div>
            ))}
            {allDocuments.length === 0 && (
              <div className="py-12 text-center">
                <FileText size={24} className="mx-auto mb-2 text-[#808080]" />
                <p className="text-[12.5px] text-[#a6a6a6]">Keine Dokumente vorhanden</p>
              </div>
            )}
          </div>
        </aside>

        <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 overflow-hidden">
          {selectedDocument ? (
            <div className="flex min-h-[680px] flex-col">
              <div className="border-b border-[#343434]/45 p-4 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <Input
                    label="Titel"
                    value={title}
                    onChange={(e) => {
                      setDocumentDirty(true)
                      setTitle(e.target.value)
                    }}
                    disabled={!canManage}
                    required
                  />
                  <div className="md:w-[240px]">
                    <Select
                      label="Ordner"
                      value={folderId}
                      onValueChange={(nextFolderId) => {
                        setDocumentDirty(true)
                        setFolderId(nextFolderId)
                      }}
                      options={folderOptions}
                      disabled={!canManage}
                    />
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveDocument} disabled={!title.trim()}><Save size={13} /> Speichern</Button>
                      <Button variant="danger" size="sm" onClick={requestDeleteDocument}><Trash2 size={13} /> Löschen</Button>
                    </div>
                  )}
                </div>
                <p className="text-[11.5px] text-[#909090]">
                  Zuletzt bearbeitet {formatDateTime(selectedDocument.updatedAt)}
                  {selectedDocument.updatedBy ? ` von ${selectedDocument.updatedBy.displayName}` : ''}
                  {documentDirty ? ' · ungespeicherte Änderungen' : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-b border-[#343434]/45 bg-[#181818]/70 px-3 py-2">
                <WriterTool icon={Heading1} label="H1" onClick={() => insertBlock('# Überschrift\n')} disabled={!canManage} />
                <WriterTool icon={Heading2} label="H2" onClick={() => insertBlock('## Abschnitt\n')} disabled={!canManage} />
                <WriterTool icon={Bold} label="Fett" onClick={() => applyMarkdown('**', '**', 'fetter Text')} disabled={!canManage} />
                <WriterTool icon={Italic} label="Kursiv" onClick={() => applyMarkdown('*', '*', 'kursiver Text')} disabled={!canManage} />
                <WriterTool icon={Code} label="Code" onClick={() => applyMarkdown('`', '`', 'code')} disabled={!canManage} />
                <WriterTool icon={LinkIcon} label="Link" onClick={() => applyMarkdown('[', '](https://)', 'Linktext')} disabled={!canManage} />
                <WriterTool icon={List} label="Liste" onClick={() => insertBlock('- Punkt\n- Punkt\n')} disabled={!canManage} />
                <WriterTool icon={ListOrdered} label="Nummeriert" onClick={() => insertBlock('1. Punkt\n2. Punkt\n')} disabled={!canManage} />
                <WriterTool icon={ListTodo} label="Checkliste" onClick={() => insertBlock('- [ ] Aufgabe\n- [ ] Aufgabe\n')} disabled={!canManage} />
                <WriterTool icon={Quote} label="Zitat" onClick={() => insertBlock('> Hinweis\n')} disabled={!canManage} />
                <WriterTool icon={Table} label="Tabelle" onClick={() => insertBlock('| Thema | Status | Notiz |\n| --- | --- | --- |\n|  |  |  |\n')} disabled={!canManage} />
                <div className="ml-auto flex rounded-[8px] border border-[#343434]/70 bg-[#181818]/70 p-0.5">
                  <button
                    type="button"
                    onClick={() => setWriterMode('split')}
                    className={cn('inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px]', writerMode === 'split' ? 'bg-[#d4d4d4] text-[#181818]' : 'text-[#a6a6a6] hover:text-white')}
                  >
                    <SplitSquareHorizontal size={12} /> Schreiben
                  </button>
                  <button
                    type="button"
                    onClick={() => setWriterMode('preview')}
                    className={cn('inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px]', writerMode === 'preview' ? 'bg-[#d4d4d4] text-[#181818]' : 'text-[#a6a6a6] hover:text-white')}
                  >
                    <Eye size={12} /> Vorschau
                  </button>
                </div>
              </div>
              <div className={cn('grid flex-1 min-h-[560px]', writerMode === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
                {writerMode === 'split' && (
                  <textarea
                    ref={editorRef}
                    value={content}
                    onChange={(e) => {
                      setDocumentDirty(true)
                      setContent(e.target.value)
                    }}
                    readOnly={!canManage}
                    className="min-h-[560px] resize-none border-r border-[#343434]/45 bg-[#080808]/45 p-5 font-mono text-[13.5px] leading-7 text-[#f4f4f4] outline-none placeholder:text-[#686868]"
                    placeholder="Markdown schreiben..."
                  />
                )}
                <div className="min-h-[560px] overflow-y-auto bg-[#181818]/35 p-5">
                  <article
                    className="markdown-document mx-auto max-w-3xl rounded-[12px] border border-[#343434]/55 bg-[#131313]/70 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[680px] flex-col items-center justify-center text-center">
              <FileText size={30} className="mb-3 text-[#808080]" />
              <p className="text-[13px] text-[#a6a6a6]">Dokument auswählen oder neu erstellen</p>
            </div>
          )}
        </section>
      </div>

      <Modal
        open={folderModalOpen}
        onClose={() => {
          setFolderModalOpen(false)
          setEditingFolder(null)
        }}
        title={editingFolder ? 'S.R.U.-Ordner bearbeiten' : 'S.R.U.-Ordner erstellen'}
      >
        <div className="space-y-4">
          <Input label="Name" value={folderForm.name} onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })} required />
          <Textarea label="Beschreibung" value={folderForm.description} onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })} rows={2} />
          <ColorField
            label="Ordnerfarbe"
            value={folderForm.color}
            onChange={(color) => setFolderForm({ ...folderForm, color })}
            presets={FOLDER_COLOR_PRESETS}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFolderModalOpen(false)
                setEditingFolder(null)
              }}
            >
              Abbrechen
            </Button>
            <Button size="sm" onClick={saveFolder} disabled={!folderForm.name.trim()}>
              {editingFolder ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={docModalOpen} onClose={() => setDocModalOpen(false)} title="S.R.U.-Dokument erstellen">
        <div className="space-y-4">
          <Input label="Titel" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required />
          <Select label="Ordner" value={docForm.folderId} onValueChange={(nextFolderId) => setDocForm({ ...docForm, folderId: nextFolderId })} options={folderOptions} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDocModalOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={createDocument} disabled={!docForm.title.trim()}>Erstellen</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  )
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmDialogState | null
  onClose: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  const confirm = async () => {
    if (!state) return
    setSubmitting(true)
    try {
      await state.onConfirm()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={!!state} onClose={onClose} title={state?.title ?? 'Bestätigen'} size="sm">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-[12px] border border-[#7f1d1d]/45 bg-[#2a1016]/55 p-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#f87171]/14 text-[#fca5a5]">
            <AlertTriangle size={17} strokeWidth={2} />
          </div>
          <p className="text-[13px] leading-6 text-[#e5e5e5]">{state?.message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="danger" size="sm" onClick={confirm} loading={submitting}>
            <Trash2 size={13} />
            {state?.confirmLabel ?? 'Bestätigen'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function WriterTool({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Bold
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#a6a6a6] transition-colors hover:bg-[#232323] hover:text-white disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon size={15} strokeWidth={2} />
    </button>
  )
}

function DocumentButton({ document, color, active, onClick }: { document: SruDocument; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-[10px] px-3 py-2 text-left transition-colors',
        active ? 'bg-[#d4d4d4]/12 border border-[#d4d4d4]/30' : 'border border-transparent hover:bg-[#232323]/65',
      )}
    >
      <span className="mb-1 block h-1 w-8 rounded-full" style={{ backgroundColor: color ?? '#d4d4d4' }} />
      <p className="truncate text-[13px] font-medium text-[#f4f4f4]">{document.title}</p>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-[#909090]">{documentPreview(document.content)}</p>
    </button>
  )
}

function SruCalendar({ canManage }: { canManage: boolean }) {
  const { data: events, loading, refetch } = useFetch<CalendarEvent[]>('/api/calendar-events?module=SRU')
  const { data: agents } = useFetch<Agent[]>(canManage ? '/api/agents' : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'SRU_TRAINING',
    startsAt: localDateTimeValue(),
    endsAt: '',
    location: '',
    agentId: '',
    discordAnnouncement: false,
  })

  const agentOptions = useMemo(() => [
    { value: '', label: 'Kein Agent-Bezug' },
    ...(agents ?? []).map((agent) => ({
      value: agent.id,
      label: `${agent.firstName} ${agent.lastName} #${displayBadgeNumber(agent.badgeNumber)}`,
    })),
  ], [agents])

  const createEvent = async () => {
    if (!form.title.trim() || !form.startsAt) return
    try {
      await execute('/api/calendar-events', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          module: 'SRU',
          description: form.description.trim() || null,
          endsAt: form.endsAt || null,
          location: form.location.trim() || null,
          agentId: form.agentId || null,
        }),
      })
      addToast({ type: 'success', title: 'S.R.U.-Termin erstellt' })
      setModalOpen(false)
      setForm({ title: '', description: '', type: 'SRU_TRAINING', startsAt: localDateTimeValue(), endsAt: '', location: '', agentId: '', discordAnnouncement: false })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Termin konnte nicht erstellt werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteEvent = async (id: string) => {
    try {
      await execute(`/api/calendar-events/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'S.R.U.-Termin gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Termin konnte nicht gelöscht werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const requestDeleteEvent = (event: CalendarEvent) => {
    setConfirmDialog({
      title: 'S.R.U.-Termin löschen',
      message: `Der Termin "${event.title}" wird dauerhaft aus dem S.R.U.-Kalender entfernt.`,
      confirmLabel: 'Termin löschen',
      onConfirm: () => deleteEvent(event.id),
    })
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="S.R.U. Kalender"
        description="Termine, Trainings und Einsätze nur für die S.R.U."
        action={(
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={refetch}><RefreshCw size={13} /> Aktualisieren</Button>
            {canManage && <Button size="sm" onClick={() => setModalOpen(true)}><Plus size={13} /> Termin</Button>}
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(events ?? []).map((event) => (
          <div key={event.id} className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[6px] border border-[#d4d4d4]/20 bg-[#d4d4d4]/8 px-2 py-0.5 text-[11px] font-semibold text-[#d4d4d4]">{calendarTypeLabel(event.type)}</span>
                  {event.discordAnnouncement && <Megaphone size={13} className="text-[#38bdf8]" />}
                </div>
                <h3 className="mt-2 text-[14px] font-semibold text-white">{event.title}</h3>
                <p className="mt-1 text-[12px] text-[#a6a6a6]">{formatDateTime(event.startsAt)}{event.endsAt ? ` -> ${formatDateTime(event.endsAt)}` : ''}</p>
              </div>
              {canManage && (
                <button type="button" onClick={() => requestDeleteEvent(event)} className="rounded-[7px] p-1.5 text-[#909090] transition-colors hover:bg-[#321218]/60 hover:text-[#fca5a5]">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {event.location && <p className="mt-3 text-[12.5px] text-[#d2d2d2]">Ort: {event.location}</p>}
            {event.description && <p className="mt-2 text-[12.5px] leading-relaxed text-[#c3c3c3]">{event.description}</p>}
            {event.agent && (
              <Link href={`/agents/${event.agent.id}`} className="mt-3 inline-flex text-[12px] text-[#d4d4d4] hover:text-white">
                {event.agent.firstName} {event.agent.lastName} #{displayBadgeNumber(event.agent.badgeNumber)}
              </Link>
            )}
          </div>
        ))}
      </div>

      {(events ?? []).length === 0 && (
        <div className="glass-panel-elevated rounded-[14px] p-12 text-center">
          <CalendarDays size={28} className="mx-auto mb-3 text-[#d4d4d4]/35" />
          <p className="text-[13px] text-[#a6a6a6]">Keine S.R.U.-Termine vorhanden</p>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="S.R.U.-Termin erstellen">
        <div className="space-y-4">
          <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <Select label="Art" value={form.type} onValueChange={(type) => setForm({ ...form, type })} options={sruEventTypes} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            <Input label="Ende optional" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </div>
          <Input label="Ort optional" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Select label="Agent-Bezug" value={form.agentId} onValueChange={(agentId) => setForm({ ...form, agentId })} options={agentOptions} />
          <Textarea label="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <label className="flex items-center gap-2 rounded-[9px] border border-[#343434]/60 bg-[#181818] px-3 py-2 text-[12.5px] text-[#c3c3c3]">
            <input type="checkbox" checked={form.discordAnnouncement} onChange={(e) => setForm({ ...form, discordAnnouncement: e.target.checked })} />
            Discord-Ankündigung senden
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={createEvent} disabled={!form.title.trim() || !form.startsAt}>Erstellen</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  )
}

export default function SruPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'sru:view')
  const canManage = hasPermission(user, 'sru:manage')
  const [activeTab, setActiveTab] = useState<Tab>('documents')

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="max-w-6xl mx-auto pb-2">
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors',
                active
                  ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                  : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
              )}
            >
              <Icon size={14} strokeWidth={2} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'documents' && <SruDocuments canManage={canManage} />}
      {activeTab === 'tasks' && (
        <TaskBoard
          module="SRU"
          title="S.R.U. Aufgaben"
          description="Aufgabenlisten für S.R.U.-Einsätze, Vorbereitung, Nachbereitung und interne Abläufe."
          accentLabel="S.R.U."
          viewPermission="sru:view"
          managePermission="sru:manage"
        />
      )}
      {activeTab === 'calendar' && <SruCalendar canManage={canManage} />}
    </div>
  )
}
