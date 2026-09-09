'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { ImageIcon, RefreshCw, Upload } from 'lucide-react'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { InvestigationsNavigation } from './investigations-navigation'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { cn } from '@/lib/utils'

export type CatalogPhoto = { id: string; title: string; url: string }

/** Rohbody-Upload statt `useApi`: der Hook nagelt jeden Request auf
 *  `application/json` fest, hier gehen aber reine Bytes raus. */
export function PhotoUploadButton({ onUploaded }: { onUploaded: (photo: CatalogPhoto) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const upload = async (file: File) => {
    setBusy(true)
    setFailure('')
    try {
      const response = await fetch('/api/investigations/photos/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-photo-title': encodeURIComponent(file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'Upload'),
          'x-upload-size': String(file.size),
        },
        body: file,
      })
      const parsed = (await response.json().catch(() => null)) as { success?: boolean; error?: string; data?: CatalogPhoto } | null
      if (!response.ok || !parsed?.success || !parsed.data) {
        throw new Error(parsed?.error || `Upload fehlgeschlagen (HTTP ${response.status})`)
      }
      onUploaded(parsed.data)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Upload fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-2">
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
    <Button type="button" size="sm" variant="outline" loading={busy} onClick={() => inputRef.current?.click()}>
      <Upload size={14} />Bild hochladen
    </Button>
    {failure && <p role="alert" className="text-xs text-red-300">{failure}</p>}
  </div>
}

export function PhotoGrid({ onSelect, selectedIds = [], onUpload }: { onSelect?: (photo: CatalogPhoto) => void; selectedIds?: string[]; onUpload?: (photo: CatalogPhoto) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<string | null>(null)
  const { data, error, loading } = useFetch<{ items: CatalogPhoto[]; total: number }>(`/api/investigations/photos?search=${encodeURIComponent(search)}&page=${page}`)
  return <div className="space-y-4">
    <Input aria-label="Bild suchen" placeholder="Bild nach Beschriftung suchen …" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
    {onUpload && <PhotoUploadButton onUploaded={photo => { onUpload(photo); setSearch(''); setPage(1) }} />}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading ? <p className="py-8 text-sm text-[#909090]">Bilder werden geladen …</p> : !data?.items.length ? <p className="py-8 text-sm text-[#909090]">Noch keine passenden Bilder. Lade eines hoch oder poste es im eingerichteten Discord-Channel.</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.items.map(photo => <button key={photo.id} type="button" onClick={() => onSelect ? onSelect(photo) : setPreview(photo.id)} aria-pressed={selectedIds.includes(photo.id)} className={cn(
        'overflow-hidden rounded-xl bg-[#181818] text-left border hover:border-[#a78bfa] focus-visible:outline-2 focus-visible:outline-[#a78bfa]',
        selectedIds.includes(photo.id) ? 'border-[#a78bfa] ring-2 ring-[#a78bfa]/40' : 'border-[#343434]',
      )}>
        <Image unoptimized src={photo.url} alt={photo.title} width={320} height={240} className="aspect-[4/3] w-full object-cover" />
        <p className="truncate px-3 py-2 text-xs text-[#d4d4d4]">{photo.title}</p>
      </button>)}
    </div>}
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-[#909090]">{data?.total ?? 0} Bilder · Seite {page}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button size="sm" variant="outline" disabled={page * 30 >= (data?.total ?? 0) || loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>
    {/* Ein gemeinsamer Betrachter statt einer eigenen Vorschau je Ansicht. */}
    <ImageLightbox images={data?.items ?? []} startId={preview} onClose={() => setPreview(null)} />
  </div>
}

export function PhotoField({ value, onChange, readOnly = false }: { value: string | null; onChange: (photo: CatalogPhoto | null) => void; readOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  return <div className="space-y-2">
    <p className="text-[12.5px] font-medium text-[#aeaeae]">Foto</p>
    {value ? <Image unoptimized src={value} alt="Aktenfoto" width={400} height={300} className="max-h-56 rounded-lg object-contain" /> : <div className="flex h-24 items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 text-sm text-[#808080]"><ImageIcon size={20} />Kein Foto ausgewählt</div>}
    {!readOnly && <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Aus Bildkatalog wählen</Button>
      <PhotoUploadButton onUploaded={photo => onChange(photo)} />
      {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Foto entfernen</Button>}
    </div>}
    <Modal open={open} onClose={() => setOpen(false)} title="Foto aus Bildkatalog auswählen" size="xl">
      <PhotoGrid onSelect={photo => { onChange(photo); setOpen(false) }} onUpload={photo => { onChange(photo); setOpen(false) }} />
      <div className="mt-4 flex justify-end border-t border-[#232323] pt-4"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button></div>
    </Modal>
  </div>
}

/** Mehrfachauswahl für Akten, die mehrere Bilder führen. Ein Upload wird
 *  sofort mit ausgewählt – sonst müsste man ihn direkt danach suchen. */
export function PhotoPicker({ value, onChange }: { value: CatalogPhoto[]; onChange: (photos: CatalogPhoto[]) => void }) {
  const [open, setOpen] = useState(false)
  const toggle = (photo: CatalogPhoto) =>
    onChange(value.some(entry => entry.id === photo.id) ? value.filter(entry => entry.id !== photo.id) : [...value, photo])

  return <div className="space-y-3">
    {value.length === 0
      ? <div className="flex h-24 items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 text-sm text-[#808080]"><ImageIcon size={20} />Noch keine Bilder ausgewählt</div>
      : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{value.map(photo => <div key={photo.id} className="relative overflow-hidden rounded-lg border border-[#343434]">
          <Image unoptimized src={photo.url} alt={photo.title} width={200} height={150} className="aspect-[4/3] w-full object-cover" />
          <button type="button" aria-label={`${photo.title} entfernen`} onClick={() => toggle(photo)} className="absolute right-1 top-1 rounded bg-[#111111]/80 px-1.5 text-xs text-[#fca5a5]">×</button>
        </div>)}</div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Bilder auswählen</Button>
      <PhotoUploadButton onUploaded={photo => onChange([...value, photo])} />
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="Bilder auswählen" size="xl">
      <PhotoGrid selectedIds={value.map(photo => photo.id)} onSelect={toggle} onUpload={photo => onChange([...value, photo])} />
      <div className="mt-4 flex justify-end"><Button type="button" onClick={() => setOpen(false)}>Fertig ({value.length})</Button></div>
    </Modal>
  </div>
}

export function PhotoCatalogPage() {
  const { user } = useAuth()
  const { execute, loading } = useApi<{ imported: number }>()
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  if (!hasPermission(user, 'investigations:view')) return <UnauthorizedContent />
  return <div><PageHeader title="Bildkatalog" description="Fotos aus dem Discord-Bilderchannel für Personenakten, Familien und Anwesen." action={hasPermission(user, 'settings:manage') && <Button variant="outline" loading={loading} onClick={async () => { try { const result = await execute('/api/investigations/photos/sync', { method: 'POST' }); setMessage(`${result?.imported ?? 0} neue Bilder importiert.`); setRevision(revision + 1) } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Import fehlgeschlagen') } }}><RefreshCw size={14} />Jetzt abgleichen</Button>} /><InvestigationsNavigation active="photos" />{message && <p role="status" className="mb-4 text-sm text-[#aeaeae]">{message}</p>}<PhotoGrid key={revision} onUpload={() => setRevision(value => value + 1)} /></div>
}
