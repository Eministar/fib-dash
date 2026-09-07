'use client'

/* eslint-disable react-hooks/refs */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bold, ChevronRight, Code, Eye, FileText, Folder, FolderPlus, Heading1, Heading2, Heading3,
  ExternalLink, Italic, Link2, List, ListOrdered, ListTodo, Maximize2, Minimize2, Plus, Quote, RefreshCw,
  Save, Search, SquareSplitHorizontal, Strikethrough, Table2, Trash2, Type,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { ColorField } from '@/components/ui/color-field'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'
import type { ModuleCalendarKey } from '@/components/modules/module-calendar'

interface UserLite { id: string; displayName: string }
interface ModuleDocument {
  id: string
  folderId: string | null
  title: string
  content: string
  externalUrl: string | null
  updatedAt: string
  updatedBy: UserLite | null
}
interface ModuleFolder {
  id: string
  name: string
  description: string | null
  color: string
  documents: ModuleDocument[]
}
interface DocumentsPayload { folders: ModuleFolder[]; looseDocuments: ModuleDocument[] }

interface ModuleDocumentsProps {
  module: ModuleCalendarKey
  title: string
  description: string
  emptyDocument: string
  canManage: boolean
}

const COLOR_PRESETS = ['#d4d4d4', '#60a5fa', '#34d399', '#f87171', '#a78bfa', '#fbbf24', '#06b6d4', '#f97316']
type ViewMode = 'edit' | 'split' | 'preview'

function preview(text: string) {
  return text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() || text.split('\n').find((l) => l.trim())?.trim() || 'Leer'
}

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  if (diff < 604800) return `vor ${Math.floor(diff / 86400)} Tag(en)`
  return formatDateTime(iso)
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function ModuleDocuments({ module, title: pageTitle, description, emptyDocument, canManage }: ModuleDocumentsProps) {
  const { data, loading, refetch } = useFetch<DocumentsPayload>(`/api/sru/folders?module=${module}`)
  const { execute } = useApi()
  const { addToast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [folderId, setFolderId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [fullscreen, setFullscreen] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [docModalOpen, setDocModalOpen] = useState(false)
  const [folderForm, setFolderForm] = useState({ name: '', description: '', color: '#d4d4d4' })
  const [docForm, setDocForm] = useState({ title: '', folderId: '', externalUrl: '' })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const allDocuments = useMemo(() => [
    ...(data?.looseDocuments ?? []),
    ...(data?.folders.flatMap((f) => f.documents) ?? []),
  ], [data])
  const selectedDocument = allDocuments.find((d) => d.id === selectedId) ?? null
  const folderOptions = useMemo(() => [
    { value: '', label: 'Ohne Ordner' },
    ...(data?.folders ?? []).map((f) => ({ value: f.id, label: f.name })),
  ], [data])
  const previewHtml = useMemo(() => renderMarkdown(content), [content])
  const directUrl = useMemo(() => safeExternalUrl(externalUrl.trim()), [externalUrl])
  const wordCount = useMemo(() => countWords(content), [content])
  const charCount = content.length

  const matchesSearch = useCallback((doc: ModuleDocument) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return doc.title.toLowerCase().includes(q)
      || doc.content.toLowerCase().includes(q)
      || (doc.externalUrl ?? '').toLowerCase().includes(q)
  }, [search])

  useEffect(() => {
    if (!selectedDocument && allDocuments.length > 0) setSelectedId(allDocuments[0].id)
  }, [allDocuments, selectedDocument])

  useEffect(() => {
    if (!selectedDocument) {
      setTitle('')
      setContent('')
      setExternalUrl('')
      setFolderId('')
      setDirty(false)
      return
    }
    if (dirty) return
    setTitle(selectedDocument.title)
    setContent(selectedDocument.content)
    setExternalUrl(selectedDocument.externalUrl ?? '')
    setFolderId(selectedDocument.folderId ?? '')
  }, [dirty, selectedDocument])

  const toggleFolder = (id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const saveDocument = useCallback(async () => {
    if (!selectedDocument || !title.trim()) return
    try {
      await execute(`/api/sru/documents/${selectedDocument.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, content, externalUrl: externalUrl.trim() || null, folderId: folderId || null }),
      })
      addToast({ type: 'success', title: 'Dokument gespeichert' })
      setDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }, [addToast, content, execute, externalUrl, folderId, refetch, selectedDocument, title])

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && canManage && title.trim()) void saveDocument()
      }
      if (e.key === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canManage, dirty, fullscreen, saveDocument, title])

  const wrapSelection = useCallback((before: string, after = before, placeholder = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.slice(start, end) || placeholder
    const next = content.slice(0, start) + before + selected + after + content.slice(end)
    setDirty(true)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }, [content])

  const insertAtLineStart = useCallback((prefix: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart)
    setDirty(true)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + prefix.length, start + prefix.length)
    })
  }, [content])

  const insertBlock = useCallback((block: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const needsNewline = start > 0 && content[start - 1] !== '\n'
    const insert = (needsNewline ? '\n' : '') + block + '\n'
    const next = content.slice(0, start) + insert + content.slice(start)
    setDirty(true)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + insert.length, start + insert.length)
    })
  }, [content])

  const toolbarActions = useMemo(() => ({
    heading1: () => insertAtLineStart('# '),
    heading2: () => insertAtLineStart('## '),
    heading3: () => insertAtLineStart('### '),
    bold: () => wrapSelection('**', '**', 'fett'),
    italic: () => wrapSelection('*', '*', 'kursiv'),
    strike: () => wrapSelection('~~', '~~', 'text'),
    code: () => wrapSelection('`', '`', 'code'),
    unorderedList: () => insertAtLineStart('- '),
    orderedList: () => insertAtLineStart('1. '),
    checklist: () => insertAtLineStart('- [ ] '),
    quote: () => insertAtLineStart('> '),
    link: () => wrapSelection('[', '](https://)', 'Link-Text'),
    table: () => insertBlock('| Spalte 1 | Spalte 2 |\n| --- | --- |\n|  |  |'),
  }), [insertAtLineStart, insertBlock, wrapSelection])

  const createFolder = async () => {
    if (!folderForm.name.trim()) return
    try {
      await execute('/api/sru/folders', {
        method: 'POST',
        body: JSON.stringify({ ...folderForm, module, description: folderForm.description || null }),
      })
      addToast({ type: 'success', title: 'Ordner erstellt' })
      setFolderModalOpen(false)
      setFolderForm({ name: '', description: '', color: '#d4d4d4' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Ordner konnte nicht erstellt werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const createDocument = async () => {
    if (!docForm.title.trim()) return
    try {
      const created = await execute('/api/sru/documents', {
        method: 'POST',
        body: JSON.stringify({
          module,
          title: docForm.title,
          folderId: docForm.folderId || null,
          content: docForm.externalUrl.trim() ? '' : emptyDocument,
          externalUrl: docForm.externalUrl.trim() || null,
        }),
      }) as ModuleDocument | null
      addToast({ type: 'success', title: 'Dokument erstellt' })
      setDocModalOpen(false)
      setDocForm({ title: '', folderId: '', externalUrl: '' })
      setDirty(false)
      await refetch()
      if (created?.id) setSelectedId(created.id)
    } catch (err) {
      addToast({ type: 'error', title: 'Dokument konnte nicht erstellt werden', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteDocument = async () => {
    if (!selectedDocument || !confirm(`Dokument "${selectedDocument.title}" löschen?`)) return
    try {
      await execute(`/api/sru/documents/${selectedDocument.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Dokument gelöscht' })
      setSelectedId(null)
      setDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }

  const selectDocument = (id: string) => {
    if (id === selectedId) return
    if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return
    setDirty(false)
    setSelectedId(id)
  }

  if (loading) return <PageLoader />

  const filteredLoose = (data?.looseDocuments ?? []).filter(matchesSearch)
  const filteredFolders = (data?.folders ?? []).map((f) => ({ ...f, documents: f.documents.filter(matchesSearch) }))

  const editor = (
      <div className={cn(
          'grid min-h-0 overflow-hidden',
          viewMode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1',
          fullscreen ? 'h-full' : 'h-[min(72vh,760px)] min-h-[560px]',
      )}>
        {viewMode !== 'preview' && (
            <div className="relative flex min-h-0 flex-col border-r border-[#343434]/45 bg-[#0f0f0f]/60">
          <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => { setDirty(true); setContent(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = e.currentTarget
                  const start = ta.selectionStart
                  const end = ta.selectionEnd
                  setContent(content.slice(0, start) + '  ' + content.slice(end))
                  setDirty(true)
                  requestAnimationFrame(() => { ta.setSelectionRange(start + 2, start + 2) })
                }
              }}
              readOnly={!canManage}
              spellCheck
              className="h-full min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent p-6 font-mono text-[13.5px] leading-[1.75] text-[#f4f4f4] outline-none placeholder:text-[#525252] selection:bg-[#d4d4d4]/30"
              placeholder="Markdown schreiben…&#10;&#10;# Überschrift&#10;**fett** *kursiv*&#10;- Liste"
          />
            </div>
        )}
        {viewMode !== 'edit' && (
            <div className="min-h-0 overflow-y-auto bg-gradient-to-b from-[#181818]/40 to-[#0f0f0f]/30 p-6">
              <article
                  className="markdown-document mx-auto max-w-3xl rounded-[14px] border border-[#343434]/55 bg-[#131313]/80 p-7 shadow-[0_18px_50px_rgba(0,0,0,0.25)]"
                  dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="text-[#686868] italic">Vorschau erscheint hier...</p>' }}
              />
            </div>
        )}
      </div>
  )

  const directDocumentView = (
    <div className={cn(
      'flex min-h-0 items-center justify-center overflow-y-auto bg-gradient-to-b from-[#181818]/40 to-[#0f0f0f]/30 p-6',
      fullscreen ? 'h-full' : 'h-[min(72vh,760px)] min-h-[560px]',
    )}>
      <div className="w-full max-w-xl rounded-[18px] border border-[#d4d4d4]/25 bg-[#131313]/90 p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[16px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/10 text-[#d4d4d4]">
          <ExternalLink size={25} strokeWidth={1.8} />
        </div>
        <p className="mt-4 text-[9.5px] font-bold uppercase tracking-[0.18em] text-[#d4d4d4]/80">Externer Dokument-Link</p>
        <h3 className="mt-1.5 text-[18px] font-semibold text-white">{title}</h3>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-[#a6a6a6]">
          Dieses Dokument wird direkt im Browser geöffnet. Der Markdown-Editor ist für diesen Eintrag deaktiviert.
        </p>
        {directUrl ? (
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-auto mt-5 inline-flex h-10 items-center gap-2 rounded-[10px] bg-gradient-to-b from-[#d4d4d4] to-[#b8b8b8] px-4 text-[13px] font-semibold text-[#181818] shadow-[0_4px_16px_rgba(212,212,212,0.18)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/60"
          >
            <ExternalLink size={15} />
            Dokument im Browser öffnen
          </a>
        ) : (
          <p className="mt-5 text-[12px] text-[#fca5a5]">Der Link ist noch nicht gültig. Bitte eine vollständige HTTP- oder HTTPS-Adresse speichern.</p>
        )}
        {directUrl && <p className="mt-4 break-all font-mono text-[10px] leading-4 text-[#686868]">{directUrl}</p>}
        {content.trim() && (
          <details className="mt-6 border-t border-[#343434]/60 pt-4 text-left">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#a6a6a6]">Interne Notizen anzeigen</summary>
            <article
              className="markdown-document mt-3 rounded-[10px] border border-[#343434]/50 bg-[#0f0f0f]/60 p-4 text-[12px] leading-5"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </details>
        )}
      </div>
    </div>
  )

  const toolbarBtn = (icon: React.ReactNode, label: string, onClick: () => void) => (
      <button
          type="button"
          onClick={onClick}
          title={label}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[#a6a6a6] transition-colors hover:bg-[#232323] hover:text-[#d4d4d4]"
      >
        {icon}
      </button>
  )

  const editorPanel = (
      <section className={cn(
          'glass-panel-elevated rounded-[14px] border border-[#373737]/45 overflow-hidden',
          fullscreen && 'fixed inset-4 z-50 flex min-h-0 flex-col',
      )}>
        {selectedDocument ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* Title bar */}
              <div className="border-b border-[#343434]/45 bg-gradient-to-r from-[#181818]/80 to-[#1b1b1b]/60 p-4 space-y-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
                  <Input label="Titel" value={title} onChange={(e) => { setDirty(true); setTitle(e.target.value) }} disabled={!canManage} required />
                  <Select label="Ordner" value={folderId} onValueChange={(v) => { setDirty(true); setFolderId(v) }} options={folderOptions} disabled={!canManage} />
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveDocument} disabled={!title.trim() || !dirty}>
                        <Save size={13} /> {dirty ? 'Speichern' : 'Gespeichert'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={deleteDocument}><Trash2 size={13} /></Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Direktlink (optional)"
                      type="url"
                      value={externalUrl}
                      onChange={(e) => { setDirty(true); setExternalUrl(e.target.value) }}
                      disabled={!canManage}
                      placeholder="https://drive.google.com/..."
                    />
                  </div>
                  {directUrl && (
                    <a
                      href={directUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[#d4d4d4]/35 bg-[#d4d4d4]/10 px-3 text-[11.5px] font-semibold text-[#c3c3c3] transition-colors hover:bg-[#d4d4d4]/16 hover:text-white"
                    >
                      <ExternalLink size={13} /> Öffnen
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[#909090]">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-[#fbbf24] animate-pulse' : 'bg-[#34d399]')} />
                {dirty ? 'Ungespeicherte Änderungen' : 'Aktuell'}
              </span>
                  <span>·</span>
                  <span>{wordCount} Wörter</span>
                  <span>·</span>
                  <span>{charCount} Zeichen</span>
                  <span>·</span>
                  <span>Aktualisiert {relativeTime(selectedDocument.updatedAt)}{selectedDocument.updatedBy ? ` von ${selectedDocument.updatedBy.displayName}` : ''}</span>
                  <span className="ml-auto hidden md:inline text-[#686868]">⌘/Ctrl + S zum Speichern</span>
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-1 border-b border-[#343434]/45 bg-[#080808]/70 px-3 py-1.5">
                {canManage && !directUrl && (
                    <>
                      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-[#343434]/60">
                        {toolbarBtn(<Heading1 size={15} />, 'Überschrift 1', toolbarActions.heading1)}
                        {toolbarBtn(<Heading2 size={15} />, 'Überschrift 2', toolbarActions.heading2)}
                        {toolbarBtn(<Heading3 size={15} />, 'Überschrift 3', toolbarActions.heading3)}
                      </div>
                      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-[#343434]/60">
                        {toolbarBtn(<Bold size={15} />, 'Fett', toolbarActions.bold)}
                        {toolbarBtn(<Italic size={15} />, 'Kursiv', toolbarActions.italic)}
                        {toolbarBtn(<Strikethrough size={15} />, 'Durchgestrichen', toolbarActions.strike)}
                        {toolbarBtn(<Code size={15} />, 'Code', toolbarActions.code)}
                      </div>
                      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-[#343434]/60">
                        {toolbarBtn(<List size={15} />, 'Aufzählung', toolbarActions.unorderedList)}
                        {toolbarBtn(<ListOrdered size={15} />, 'Nummeriert', toolbarActions.orderedList)}
                        {toolbarBtn(<ListTodo size={15} />, 'Aufgabe', toolbarActions.checklist)}
                        {toolbarBtn(<Quote size={15} />, 'Zitat', toolbarActions.quote)}
                      </div>
                      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-[#343434]/60">
                        {toolbarBtn(<Link2 size={15} />, 'Link', toolbarActions.link)}
                        {toolbarBtn(<Table2 size={15} />, 'Tabelle', toolbarActions.table)}
                      </div>
                    </>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  {!directUrl && (['edit', 'split', 'preview'] as ViewMode[]).map((mode) => {
                    const Icon = mode === 'edit' ? Type : mode === 'split' ? SquareSplitHorizontal : Eye
                    const label = mode === 'edit' ? 'Editor' : mode === 'split' ? 'Geteilt' : 'Vorschau'
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        title={label}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11.5px] font-medium transition-colors',
                          viewMode === mode ? 'bg-[#d4d4d4]/15 text-[#d4d4d4]' : 'text-[#a6a6a6] hover:bg-[#232323] hover:text-white',
                        )}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    )
                  })}
                  {directUrl && <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[11px] font-semibold text-[#d4d4d4]"><ExternalLink size={13} /> Browseransicht</span>}
                  <button
                      type="button"
                      onClick={() => setFullscreen((v) => !v)}
                      title={fullscreen ? 'Vollbild verlassen' : 'Vollbild'}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[#a6a6a6] transition-colors hover:bg-[#232323] hover:text-white ml-1"
                  >
                    {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">{directUrl ? directDocumentView : editor}</div>
            </div>
        ) : (
            <div className="flex min-h-[680px] flex-col items-center justify-center text-center px-6">
              <div className="rounded-full bg-[#d4d4d4]/10 p-5 mb-4">
                <FileText size={32} className="text-[#d4d4d4]/70" />
              </div>
              <p className="text-[14px] font-semibold text-[#e5e5e5] mb-1">Kein Dokument ausgewählt</p>
              <p className="text-[12.5px] text-[#a6a6a6] mb-4 max-w-xs">Wähle ein Dokument aus der Seitenleiste oder erstelle ein neues.</p>
              {canManage && <Button size="sm" onClick={() => setDocModalOpen(true)}><Plus size={13} /> Neues Dokument</Button>}
            </div>
        )}
      </section>
  )

  return (
      <div className="space-y-5">
        <PageHeader
            title={pageTitle}
            description={description}
            action={canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setFolderModalOpen(true)}><FolderPlus size={13} /> Ordner</Button>
                  <Button size="sm" onClick={() => setDocModalOpen(true)}><Plus size={13} /> Dokument</Button>
                </div>
            ) : undefined}
        />

        {fullscreen && <div className="fixed inset-0 bg-[#070707]/85 backdrop-blur-sm z-40" onClick={() => setFullscreen(false)} />}

        <div className={cn('grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4', fullscreen && 'lg:grid-cols-1')}>
          {!fullscreen && (
              <aside className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 overflow-hidden">
                <div className="border-b border-[#343434]/45 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[#a6a6a6]">Ablage</p>
                    <div className="flex items-center gap-1">
                      <span className="text-[10.5px] text-[#686868]">{allDocuments.length}</span>
                      <button type="button" onClick={refetch} className="p-1 rounded-[6px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/70" title="Aktualisieren">
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#686868]" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Suchen…"
                        className="h-8 w-full rounded-[7px] border border-[#343434]/60 bg-[#0f0f0f] pl-7 pr-2 text-[12px] text-[#f4f4f4] placeholder:text-[#686868] outline-none focus:border-[#d4d4d4]/40"
                    />
                  </div>
                </div>
                <div className="max-h-[640px] overflow-y-auto p-1.5">
                  {filteredLoose.length > 0 && (
                      <div className="mb-2">
                        <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[#686868] font-semibold">Ohne Ordner</p>
                        {filteredLoose.map((doc) => (
                            <DocumentButton key={doc.id} document={doc} active={selectedId === doc.id} onClick={() => selectDocument(doc.id)} />
                        ))}
                      </div>
                  )}
                  {filteredFolders.map((folder) => {
                    const collapsed = collapsedFolders.has(folder.id)
                    if (search && folder.documents.length === 0) return null
                    return (
                        <div key={folder.id} className="mb-1.5">
                          <button
                              type="button"
                              onClick={() => toggleFolder(folder.id)}
                              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-[7px] hover:bg-[#232323]/55 transition-colors group"
                          >
                            <ChevronRight size={11} className={cn('text-[#686868] transition-transform', !collapsed && 'rotate-90')} />
                            <Folder size={12} style={{ color: folder.color }} />
                            <span className="flex-1 truncate text-left text-[12px] font-semibold text-[#e5e5e5]">{folder.name}</span>
                            <span className="text-[10px] text-[#686868]">{folder.documents.length}</span>
                          </button>
                          {!collapsed && (
                              <div className="ml-1.5 pl-2 border-l border-[#343434]/40">
                                {folder.documents.length === 0 ? (
                                    <p className="px-2 py-1.5 text-[10.5px] text-[#686868] italic">Leer</p>
                                ) : (
                                    folder.documents.map((doc) => (
                                        <DocumentButton key={doc.id} document={doc} color={folder.color} active={selectedId === doc.id} onClick={() => selectDocument(doc.id)} />
                                    ))
                                )}
                              </div>
                          )}
                        </div>
                    )
                  })}
                  {allDocuments.length === 0 && (
                      <div className="py-12 text-center px-4">
                        <FileText size={22} className="mx-auto mb-2 text-[#808080]" />
                        <p className="text-[12px] text-[#a6a6a6] mb-3">Noch keine Dokumente</p>
                        {canManage && (
                            <Button size="sm" variant="secondary" onClick={() => setDocModalOpen(true)}>
                              <Plus size={12} /> Erstellen
                            </Button>
                        )}
                      </div>
                  )}
                  {allDocuments.length > 0 && search && filteredLoose.length === 0 && filteredFolders.every((f) => f.documents.length === 0) && (
                      <p className="py-8 text-center text-[11.5px] text-[#686868]">Keine Treffer für {search}</p>
                  )}
                </div>
              </aside>
          )}

          {editorPanel}
        </div>

        <Modal open={folderModalOpen} onClose={() => setFolderModalOpen(false)} title={`${pageTitle}: Ordner erstellen`}>
          <div className="space-y-4">
            <Input label="Name" value={folderForm.name} onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })} required />
            <Textarea label="Beschreibung" value={folderForm.description} onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })} rows={2} />
            <ColorField label="Ordnerfarbe" value={folderForm.color} onChange={(color) => setFolderForm({ ...folderForm, color })} presets={COLOR_PRESETS} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setFolderModalOpen(false)}>Abbrechen</Button>
              <Button size="sm" onClick={createFolder} disabled={!folderForm.name.trim()}>Erstellen</Button>
            </div>
          </div>
        </Modal>

        <Modal open={docModalOpen} onClose={() => setDocModalOpen(false)} title={`${pageTitle}: Dokument erstellen`}>
          <div className="space-y-4">
            <Input label="Titel" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required />
            <Select label="Ordner" value={docForm.folderId} onValueChange={(v) => setDocForm({ ...docForm, folderId: v })} options={folderOptions} />
            <div>
              <Input
                label="Direktlink (optional)"
                type="url"
                value={docForm.externalUrl}
                onChange={(e) => setDocForm({ ...docForm, externalUrl: e.target.value })}
                placeholder="https://drive.google.com/..."
              />
              <p className="mt-1.5 text-[10.5px] leading-4 text-[#767676]">
                Mit einem Link öffnet sich der Eintrag direkt im Browser statt im Markdown-Editor.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDocModalOpen(false)}>Abbrechen</Button>
              <Button size="sm" onClick={createDocument} disabled={!docForm.title.trim()}>Erstellen</Button>
            </div>
          </div>
        </Modal>
      </div>
  )
}

function DocumentButton({ document, color, active, onClick }: { document: ModuleDocument; color?: string; active: boolean; onClick: () => void }) {
  return (
      <button
          type="button"
          onClick={onClick}
          className={cn(
              'w-full rounded-[8px] px-2.5 py-2 text-left transition-all group relative',
              active
                  ? 'bg-gradient-to-r from-[#d4d4d4]/15 to-[#d4d4d4]/5 border border-[#d4d4d4]/30 shadow-[0_2px_10px_rgba(212,212,212,0.08)]'
                  : 'border border-transparent hover:bg-[#232323]/60',
          )}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-r bg-[#d4d4d4]" />}
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color ?? '#d4d4d4' }} />
          <p className={cn('truncate text-[12.5px] font-medium flex-1', active ? 'text-white' : 'text-[#f4f4f4]')}>{document.title}</p>
          {document.externalUrl && <ExternalLink size={11} className="shrink-0 text-[#d4d4d4]" aria-label="Direktlink" />}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-[#909090] pl-3.5">{document.externalUrl ? 'Direkt im Browser öffnen' : preview(document.content)}</p>
      </button>
  )
}
