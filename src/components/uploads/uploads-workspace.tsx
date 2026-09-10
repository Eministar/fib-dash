'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FileText, FileJson, Film, Image as ImageIcon, KeyRound, Upload as UploadIcon, File } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { formatDateTime, cn } from '@/lib/utils'
import { formatBytes, previewKind } from '@/lib/file-upload-types'
import { UploadDetail } from './upload-detail'
import type { Upload, UploadList } from './upload-types'

function KindIcon({ mimeType }: { mimeType: string }) {
  const kind = previewKind(mimeType)
  if (kind === 'image') return <ImageIcon size={16} />
  if (kind === 'video') return <Film size={16} />
  if (kind === 'html' || kind === 'text') return <FileText size={16} />
  if (mimeType === 'application/json') return <FileJson size={16} />
  return <File size={16} />
}

/** Neue Datei aus dem Dashboard heraus — derselbe Endpoint, nur per Session. */
function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<globalThis.File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setFailure('')
    try {
      const form = new FormData()
      form.append('file', file)
      if (title.trim()) form.append('title', title.trim())
      if (description.trim()) form.append('description', description.trim())
      if (category.trim()) form.append('category', category.trim())
      if (tags.trim()) form.append('tags', tags.trim())
      if (externalRef.trim()) form.append('externalRef', externalRef.trim())
      // Kein useApi: das setzt Content-Type application/json, multipart
      // braucht aber die vom Browser erzeugte boundary.
      const res = await fetch('/api/files', { method: 'POST', body: form, credentials: 'include' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Upload fehlgeschlagen')
      onUploaded()
      onClose()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Upload fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Datei hochladen" size="lg">
      <form className="space-y-4" onSubmit={submit}>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const dropped = e.dataTransfer.files?.[0]
            if (dropped) setFile(dropped)
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-xl border border-dashed p-8 text-center text-sm',
            dragging ? 'border-[#dcba48] bg-[#dcba48]/5 text-white' : 'border-[#343434] text-[#909090] hover:border-[#707070]',
          )}
        >
          <UploadIcon className="mx-auto mb-2" size={22} />
          {file ? (
            <span className="text-white">
              {file.name} <span className="text-[#909090]">· {formatBytes(file.size)}</span>
            </span>
          ) : (
            'Datei hierher ziehen oder klicken zum Auswählen'
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <Input label="Titel (leer = Dateiname)" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Beschreibung" rows={3} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Kategorie" maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input label="Tags (mit Komma trennen)" value={tags} onChange={(e) => setTags(e.target.value)} />
          <Input label="Referenz (z. B. Ticketnummer)" maxLength={200} value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
        </div>

        {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" loading={busy} disabled={!file}>
            Hochladen
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function UploadsWorkspace({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Upload | null>(null)
  const [uploading, setUploading] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (search.trim()) params.set('search', search.trim())
    if (category) params.set('category', category)
    return params.toString()
  }, [search, category, page])

  const list = useFetch<UploadList>(`/api/files?${query}`)
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const pageSize = list.data?.pageSize ?? 24
  const pages = Math.max(1, Math.ceil(total / pageSize))

  // Nach dem Neuladen zeigt das offene Detail sonst noch die alten Werte.
  const refresh = async () => {
    await list.refetch()
    setSelected((current) => (current ? null : current))
  }

  return (
    <div className="mx-auto max-w-6xl pb-6">
      <PageHeader
        title="Uploads"
        description="Dateien aus dem Ticketboard und anderen Systemen — Transkripte, Bilder, Dokumente."
        action={
          <div className="flex gap-2">
            {canManage && (
              <Link href="/uploads/keys">
                <Button variant="secondary">
                  <KeyRound size={15} />
                  Upload-Schlüssel
                </Button>
              </Link>
            )}
            <Button onClick={() => setUploading(true)}>
              <UploadIcon size={15} />
              Datei hochladen
            </Button>
          </div>
        }
      />

      <section aria-label="Filter" className="mb-5 grid gap-3 rounded-xl border border-[#343434] bg-[#141414] p-4 sm:grid-cols-2">
        <Input
          label="Suche"
          placeholder="Titel, Beschreibung, Dateiname, Ticketnummer …"
          maxLength={200}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <Select
          label="Kategorie"
          value={category}
          onValueChange={(value) => {
            setCategory(value)
            setPage(1)
          }}
          options={[{ value: '', label: 'Alle Kategorien' }, ...(list.data?.categories ?? []).map((c) => ({ value: c, label: c }))]}
        />
      </section>

      {list.error && <p role="alert" className="mb-4 text-sm text-red-300">{list.error}</p>}

      {list.loading && !items.length ? (
        <p className="py-8 text-sm text-[#909090]">Uploads werden geladen …</p>
      ) : !items.length ? (
        <div className="rounded-xl border border-dashed border-[#343434] p-8 text-center text-sm text-[#909090]">
          <UploadIcon className="mx-auto mb-3" size={25} />
          Noch keine Uploads. Lade eine Datei hoch oder richte einen Upload-Schlüssel für das Ticketboard ein.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((upload) => (
            <button
              key={upload.id}
              type="button"
              onClick={() => setSelected(upload)}
              className="rounded-xl border border-[#343434] bg-[#141414] p-4 text-left hover:border-[#707070]"
            >
              <div className="flex items-start gap-2 text-[#a6a6a6]">
                <KindIcon mimeType={upload.mimeType} />
                <span className="min-w-0 flex-1 truncate font-semibold text-white">{upload.title}</span>
              </div>
              {upload.description && <p className="mt-2 line-clamp-2 text-xs text-[#a6a6a6]">{upload.description}</p>}
              <p className="mt-2 text-xs text-[#7a7a7a]">
                {formatDateTime(upload.createdAt)} · {formatBytes(upload.sizeBytes)}
              </p>
              <p className="mt-1 truncate text-xs text-[#7a7a7a]">
                {upload.category ? `${upload.category} · ` : ''}
                {upload.uploadKey ? upload.uploadKey.name : upload.uploadedBy?.displayName ?? 'Unbekannt'}
                {upload.externalRef ? ` · ${upload.externalRef}` : ''}
              </p>
              {!!upload.tags.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {upload.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded border border-[#343434] px-1.5 py-0.5 text-[10px] text-[#a6a6a6]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm text-[#a6a6a6]">
          <Button variant="secondary" size="sm" disabled={page <= 1 || list.loading} onClick={() => setPage(page - 1)}>
            Zurück
          </Button>
          <span>
            Seite {page} von {pages} · {total} Uploads
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages || list.loading} onClick={() => setPage(page + 1)}>
            Weiter
          </Button>
        </div>
      )}

      {uploading && <UploadDialog onClose={() => setUploading(false)} onUploaded={() => void list.refetch()} />}
      {selected && (
        <UploadDetail upload={selected} canManage={canManage} onClose={() => setSelected(null)} onChanged={() => void refresh()} />
      )}
    </div>
  )
}
