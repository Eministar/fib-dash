'use client'

import { useState } from 'react'
import { Download, ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { formatDateTime } from '@/lib/utils'
import { formatBytes, previewKind } from '@/lib/file-upload-types'
import type { Upload } from './upload-types'

/**
 * Betrachter für eine hochgeladene Datei.
 *
 * HTML läuft in einem `sandbox`-iframe: ohne `allow-scripts` und ohne
 * `allow-same-origin` bekommt das fremde Dokument einen eigenen, rechtelosen
 * Origin und kommt damit weder an die Session noch an das Dashboard.
 */
function Viewer({ upload }: { upload: Upload }) {
  const kind = previewKind(upload.mimeType)
  const frame = 'h-[70vh] w-full rounded-lg border border-[#343434] bg-[#0d0d0d]'

  if (kind === 'html') return <iframe title={upload.title} src={upload.viewUrl} sandbox="" className={frame} />
  if (kind === 'text') return <iframe title={upload.title} src={upload.viewUrl} sandbox="" className={frame} />
  if (kind === 'pdf') return <iframe title={upload.title} src={upload.viewUrl} className={frame} />
  if (kind === 'image')
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Die Datei liegt hinter einer Auth-Route, nicht im Bild-Optimizer.
      <img src={upload.viewUrl} alt={upload.title} className="max-h-[70vh] w-full rounded-lg border border-[#343434] object-contain" />
    )
  if (kind === 'video') return <video src={upload.viewUrl} controls className={frame} />

  return (
    <div className="rounded-lg border border-dashed border-[#343434] p-8 text-center text-sm text-[#909090]">
      Für diesen Dateityp gibt es keine Vorschau — bitte herunterladen.
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-[#7a7a7a]">{label}</p>
      <div className="mt-0.5 text-sm text-[#e4e4e4]">{children}</div>
    </div>
  )
}

export function UploadDetail({
  upload,
  canManage,
  onClose,
  onChanged,
}: {
  upload: Upload
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(upload.title)
  const [description, setDescription] = useState(upload.description ?? '')
  const [category, setCategory] = useState(upload.category ?? '')
  const [tags, setTags] = useState(upload.tags.join(', '))
  const [externalRef, setExternalRef] = useState(upload.externalRef ?? '')
  const [externalUrl, setExternalUrl] = useState(upload.externalUrl ?? '')
  const [failure, setFailure] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { execute, loading } = useApi<Upload>()

  const save = async () => {
    setFailure('')
    try {
      const updated = await execute(`/api/files/${upload.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category: category.trim(),
          tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
          externalRef: externalRef.trim(),
          ...(externalUrl.trim() ? { externalUrl: externalUrl.trim() } : {}),
        }),
      })
      if (updated) {
        setEditing(false)
        onChanged()
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen')
    }
  }

  const remove = async () => {
    setFailure('')
    try {
      await execute(`/api/files/${upload.id}`, { method: 'DELETE' })
      onChanged()
      onClose()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen')
    }
  }

  const metadataEntries = Object.entries(upload.metadata ?? {})

  return (
    <Modal open onClose={onClose} title={upload.title} size="xl">
      <div className="space-y-5">
        <Viewer upload={upload} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Meta label="Datei">
            {upload.originalName}
            <span className="text-[#909090]"> · {formatBytes(upload.sizeBytes)} · {upload.mimeType}</span>
          </Meta>
          <Meta label="Hochgeladen">{formatDateTime(upload.createdAt)}</Meta>
          <Meta label="Herkunft">
            {upload.uploadKey ? `API-Schlüssel „${upload.uploadKey.name}“` : upload.uploadedBy?.displayName ?? 'Unbekannt'}
            {upload.externalUser ? ` · ${upload.externalUser}` : ''}
          </Meta>
          {upload.category && <Meta label="Kategorie">{upload.category}</Meta>}
          {!!upload.tags.length && <Meta label="Tags">{upload.tags.join(', ')}</Meta>}
          {upload.externalRef && (
            <Meta label="Referenz">
              {upload.externalUrl ? (
                <a href={upload.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">
                  {upload.externalRef}
                  <ExternalLink size={13} />
                </a>
              ) : (
                upload.externalRef
              )}
            </Meta>
          )}
        </div>

        {upload.description && !editing && <p className="whitespace-pre-wrap text-sm text-[#c4c4c4]">{upload.description}</p>}

        {!!metadataEntries.length && (
          <div className="rounded-lg border border-[#343434] p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-[#7a7a7a]">Zusatzfelder</p>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              {metadataEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-[#909090]">{key}:</dt>
                  <dd className="min-w-0 break-all text-[#d4d4d4]">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {editing && (
          <div className="space-y-3 rounded-lg border border-[#343434] p-4">
            <Input label="Titel" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea label="Beschreibung" rows={4} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Kategorie" maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} />
              <Input label="Tags (mit Komma trennen)" value={tags} onChange={(e) => setTags(e.target.value)} />
              <Input label="Referenz (z. B. Ticketnummer)" maxLength={200} value={externalRef} onChange={(e) => setExternalRef(e.target.value)} />
              <Input label="Link zum Fremdsystem" maxLength={2000} value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
            </div>
          </div>
        )}

        {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <a href={upload.viewUrl} download={upload.originalName}>
            <Button type="button" variant="secondary">
              <Download size={15} />
              Herunterladen
            </Button>
          </a>
          {canManage &&
            (editing ? (
              <>
                <Button type="button" variant="ghost" disabled={loading} onClick={() => setEditing(false)}>
                  Abbrechen
                </Button>
                <Button type="button" loading={loading} onClick={save}>
                  Speichern
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="danger" disabled={loading} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} />
                  Löschen
                </Button>
                <Button type="button" onClick={() => setEditing(true)}>
                  Bearbeiten
                </Button>
              </>
            ))}
        </div>
      </div>

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(false)} title="Upload löschen?" description="Die Datei wird endgültig entfernt.">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={loading} onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={remove}>
              Endgültig löschen
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
