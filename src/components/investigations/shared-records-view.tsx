'use client'

import { useCallback, useMemo, useState } from 'react'
import { Car, Clapperboard, FileText, Gavel, Search, User, Users } from 'lucide-react'
import { useFetch } from '@/hooks/use-fetch'
import { ListSkeleton } from '@/components/ui/loading'
import { SHARE_KINDS, type ShareKind } from '@/lib/investigations/record-share-kinds'
import { RaidBinder, RAID_COLOR, type RaidShare } from './binder/raid-binder'
import { KIND_COLORS, KIND_NAMES, RecordBinder, type SharedItem } from './binder/record-binder'

type Overview = { title: string; expiresAt: string | null; items: SharedItem[]; raid: RaidShare | null }
type Open = { type: 'raid' } | { type: 'record'; item: SharedItem } | null

const KIND_ICONS: Record<ShareKind, typeof Users> = { DOSSIER: Users, CASE: FileText, PERSON: User, VEHICLE: Car, CLIP: Clapperboard }
const KIND_ORDER: ShareKind[] = ['DOSSIER', 'CASE', 'PERSON', 'VEHICLE', 'CLIP']

/**
 * Öffentliche Leseansicht einer Freigabe: ein Aktenregal mit einem Ordner je
 * Akte. Geöffnete Ordner zeigen echte DIN-A4-Seiten zum Durchblättern.
 */
export function SharedRecordsView({ token }: { token: string }) {
  const { data, error, loading } = useFetch<Overview>(`/api/shared-records/${encodeURIComponent(token)}`)
  const [open, setOpen] = useState<Open>(null)
  const [search, setSearch] = useState('')

  const openItem = useCallback((item: SharedItem) => setOpen({ type: 'record', item }), [])
  const close = useCallback(() => setOpen(null), [])

  const shelves = useMemo(() => {
    const term = search.trim().toLowerCase()
    const items = (data?.items ?? []).filter((item) => !term || item.title.toLowerCase().includes(term) || KIND_NAMES[item.kind].toLowerCase().includes(term))
    return KIND_ORDER.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter((shelf) => shelf.items.length)
  }, [data, search])

  // Abgelaufene oder widerrufene Freigaben sofort verbergen.
  if (error) {
    return (
      <main className="share-room">
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shield.webp" alt="" aria-hidden className="mx-auto mb-6 h-16 w-16 opacity-60" />
          <h1 className="text-xl font-semibold text-white">Freigabe nicht verfügbar</h1>
          <p className="mt-3 text-sm text-[#98989d]">Der Link ist ungültig, deaktiviert, abgelaufen oder momentan nicht erreichbar.</p>
        </div>
      </main>
    )
  }
  if (loading || !data) return <main className="share-room"><div className="mx-auto max-w-6xl px-4 py-10"><ListSkeleton compact /></div></main>

  const permitted = open?.type === 'record' && data.items.some((item) => item.kind === open.item.kind && item.recordId === open.item.recordId)

  return (
    <main className="share-room">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-8">
        <header className="share-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shield.webp" alt="" aria-hidden className="share-crest" />
          <div className="min-w-0">
            <p className="share-eyebrow">Federal Investigation Bureau · {data.raid ? 'Antrag mit Anlagen' : 'Freigegebene Unterlagen'}</p>
            <h1 className="share-title">{data.title}</h1>
            <p className="share-sub">
              {data.items.length} {data.items.length === 1 ? 'Akte' : 'Akten'} zur Einsicht
              {data.expiresAt ? ` · Einsicht bis ${new Date(data.expiresAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </p>
          </div>
        </header>

        {data.raid && (
          <section className="mb-10" aria-label="Antrag">
            <button type="button" className="raid-dossier" onClick={() => setOpen({ type: 'raid' })} style={{ ['--raid' as string]: RAID_COLOR }}>
              <span className="raid-dossier-paper" aria-hidden />
              <span className="raid-dossier-paper raid-dossier-paper-2" aria-hidden />
              <span className="raid-dossier-front">
                <span className="raid-dossier-icon"><Gavel size={22} /></span>
                <span className="min-w-0 text-left">
                  <span className="raid-dossier-kicker">Antrag auf richterliche Anordnung · {data.raid.reference}</span>
                  <span className="raid-dossier-title">Durchsuchung und Beschlagnahme – {data.raid.request.target}</span>
                  <span className="raid-dossier-meta">{data.items.length} Anlagen{data.raid.laws.length ? ` · ${data.raid.laws.length} Gesetzestexte` : ''} · zum Öffnen klicken</span>
                </span>
              </span>
            </button>
          </section>
        )}

        <div className="share-search">
          <Search size={15} aria-hidden />
          <input aria-label="Akten durchsuchen" placeholder="Akten durchsuchen …" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {shelves.map((shelf) => (
          <section key={shelf.kind} className="shelf" aria-label={SHARE_KINDS[shelf.kind]}>
            <h2 className="shelf-label">{SHARE_KINDS[shelf.kind]} <span>{shelf.items.length}</span></h2>
            <div className="shelf-row">
              {shelf.items.map((item) => <Binder key={`${item.kind}:${item.recordId}`} item={item} onOpen={() => openItem(item)} />)}
            </div>
            <div className="shelf-board" aria-hidden />
          </section>
        ))}
        {!shelves.length && <p className="py-10 text-center text-sm text-[#8e8e93]">{search ? 'Keine passende Akte.' : 'Aktuell sind keine Akten verfügbar.'}</p>}
      </div>

      {open?.type === 'raid' && data.raid && <RaidBinder raid={data.raid} items={data.items} onClose={close} onOpen={openItem} />}
      {open?.type === 'record' && permitted && <RecordBinder key={`${open.item.kind}:${open.item.recordId}`} token={token} item={open.item} onClose={close} onOpen={openItem} />}
    </main>
  )
}

/** Ordnerrücken im Regal: Farbe je Aktenart, Rückenschild mit Aktenzeichen und Titel, Griffloch. */
function Binder({ item, onOpen }: { item: SharedItem; onOpen: () => void }) {
  const Icon = KIND_ICONS[item.kind]
  const [reference, ...rest] = item.title.split(' · ')
  const hasReference = rest.length > 0 && item.kind !== 'DOSSIER' && item.kind !== 'CLIP'
  return (
    <button type="button" className="binder" onClick={onOpen} style={{ ['--binder' as string]: KIND_COLORS[item.kind] }} aria-label={`${KIND_NAMES[item.kind]} ${item.title} öffnen`}>
      <span className="binder-label">
        <span className="binder-label-kind"><Icon size={12} aria-hidden />{KIND_NAMES[item.kind]}</span>
        {hasReference && <span className="binder-label-ref">{reference}</span>}
        <span className="binder-label-title">{hasReference ? rest.join(' · ') : item.title}</span>
      </span>
      <span className="binder-hole" aria-hidden />
    </button>
  )
}
