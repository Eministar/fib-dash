'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ImageIcon, RefreshCw } from 'lucide-react'
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

export type CatalogPhoto = { id: string; title: string; url: string }

export function PhotoGrid({ onSelect }: { onSelect?: (photo: CatalogPhoto) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<CatalogPhoto | null>(null)
  const { data, error, loading } = useFetch<{ items: CatalogPhoto[]; total: number }>(`/api/investigations/photos?search=${encodeURIComponent(search)}&page=${page}`)
  return <div className="space-y-4">
    <Input aria-label="Bild suchen" placeholder="Bild nach Beschriftung suchen …" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading ? <p className="py-8 text-sm text-[#909090]">Bilder werden geladen …</p> : !data?.items.length ? <p className="py-8 text-sm text-[#909090]">Noch keine passenden Bilder. Fotos im eingerichteten Discord-Channel erscheinen hier automatisch.</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {data.items.map(photo => <button key={photo.id} type="button" onClick={() => onSelect ? onSelect(photo) : setPreview(photo)} className="overflow-hidden rounded-xl border border-[#343434] bg-[#181818] text-left hover:border-[#a78bfa] focus-visible:outline-2 focus-visible:outline-[#a78bfa]">
        <Image unoptimized src={photo.url} alt={photo.title} width={320} height={240} className="aspect-[4/3] w-full object-cover" />
        <p className="truncate px-3 py-2 text-xs text-[#d4d4d4]">{photo.title}</p>
      </button>)}
    </div>}
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-[#909090]">{data?.total ?? 0} Bilder · Seite {page}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button size="sm" variant="outline" disabled={page * 30 >= (data?.total ?? 0) || loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>
    {preview && <Modal open onClose={() => setPreview(null)} title={preview.title} size="xl"><Image unoptimized src={preview.url} alt={preview.title} width={1400} height={1000} className="max-h-[65vh] w-full object-contain" /></Modal>}
  </div>
}

export function PhotoField({ value, onChange, readOnly = false }: { value: string | null; onChange: (photo: CatalogPhoto | null) => void; readOnly?: boolean }) {
  const [open, setOpen] = useState(false)
  return <div className="space-y-2">
    <p className="text-[12.5px] font-medium text-[#aeaeae]">Foto</p>
    {value ? <Image unoptimized src={value} alt="Aktenfoto" width={400} height={300} className="max-h-56 rounded-lg object-contain" /> : <div className="flex h-24 items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 text-sm text-[#808080]"><ImageIcon size={20} />Kein Foto ausgewählt</div>}
    {!readOnly && <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Aus Bildkatalog wählen</Button>{value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Foto entfernen</Button>}</div>}
    <Modal open={open} onClose={() => setOpen(false)} title="Foto aus Bildkatalog auswählen" size="xl"><PhotoGrid onSelect={photo => { onChange(photo); setOpen(false) }} /></Modal>
  </div>
}

export function PhotoCatalogPage() {
  const { user } = useAuth()
  const { execute, loading } = useApi<{ imported: number }>()
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  if (!hasPermission(user, 'investigations:view')) return <UnauthorizedContent />
  return <div><PageHeader title="Bildkatalog" description="Fotos aus dem Discord-Bilderchannel für Personenakten, Familien und Anwesen." action={hasPermission(user, 'settings:manage') && <Button variant="outline" loading={loading} onClick={async () => { try { const result = await execute('/api/investigations/photos/sync', { method: 'POST' }); setMessage(`${result?.imported ?? 0} neue Bilder importiert.`); setRevision(revision + 1) } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Import fehlgeschlagen') } }}><RefreshCw size={14} />Jetzt abgleichen</Button>} /><InvestigationsNavigation active="photos" />{message && <p role="status" className="mb-4 text-sm text-[#aeaeae]">{message}</p>}<PhotoGrid key={revision} /></div>
}
