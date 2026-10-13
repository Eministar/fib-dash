'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFetch } from '@/hooks/use-fetch'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { ListSkeleton } from '@/components/ui/loading'

export function FamilyDossierField({ dossierId, disabled, onChange }: {
  dossierId?: string | null
  disabled?: boolean
  onChange: (id: string | null, title?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useDebouncedValue(search)
  const selected = useFetch<{ title: string }>(dossierId ? `/api/investigations/dossiers/${encodeURIComponent(dossierId)}` : null)
  const list = useFetch<{ items: { id: string; title: string }[]; total: number }>(open ? `/api/investigations/dossiers?kind=FAMILY&search=${encodeURIComponent(query)}&page=${page}` : null)
  return <div className="space-y-2 sm:col-span-full">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-neutral-400">Dauerakte</span>
      {dossierId && <Link className="text-white underline underline-offset-4" href={`/investigations/dossiers?id=${encodeURIComponent(dossierId)}`}>{selected.data?.title ?? 'Verknüpfte Akte öffnen'}</Link>}
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{dossierId ? 'Andere Akte wählen' : 'Familienakte verknüpfen'}</Button>
      {dossierId && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>Verknüpfung entfernen</Button>}
    </div>
    {selected.error && <p role="alert" className="text-xs text-amber-300">Die verknüpfte Akte ist nicht verfügbar. Wähle eine andere Akte oder entferne die Verknüpfung.</p>}
    {open && <Modal open onClose={() => setOpen(false)} title="Familienakte auswählen">
      <div className="space-y-3">
        <Input aria-label="Familienakte suchen" placeholder="Zum Beispiel Founders Company" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
        {list.error ? <p role="alert" className="text-sm text-red-300">{list.error}</p> : list.loading ? <ListSkeleton compact /> : <ul className="max-h-72 space-y-1 overflow-y-auto">
          {list.data?.items.map(dossier => <li key={dossier.id}><button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => { onChange(dossier.id, dossier.title); setOpen(false) }}>{dossier.title}</button></li>)}
          {!list.data?.items.length && <li className="text-sm text-neutral-400">Keine passende Familienakte gefunden.</li>}
        </ul>}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" disabled={page === 1 || list.loading} onClick={() => setPage(page - 1)}>Zurück</Button>
          <span className="text-xs text-neutral-400">Seite {page}</span>
          <Button type="button" variant="ghost" size="sm" disabled={!list.data || page * 30 >= list.data.total || list.loading} onClick={() => setPage(page + 1)}>Weiter</Button>
        </div>
      </div>
    </Modal>}
  </div>
}
