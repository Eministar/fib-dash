'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useFetch } from '@/hooks/use-fetch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SHARE_KINDS, type ShareKind } from '@/lib/record-share-validation'

type Item = { kind: ShareKind; recordId: string; title: string }
type Detail = Item & { label: string; fields: { label: string; value: string }[]; entries: { title: string; content: string | null; occurredAt: string; kind: string }[]; hasPhoto: boolean; hasVideo: boolean }
export function SharedRecordsView({ token }: { token: string }) {
  const { data, error, loading } = useFetch<{ title: string; expiresAt: string | null; items: Item[] }>(`/api/shared-records/${encodeURIComponent(token)}`)
  const [selected, setSelected] = useState<Item | null>(null)
  const [search, setSearch] = useState('')
  // Hide stale data immediately when a refetch detects expiry or revocation.
  if (error) return <main className="mx-auto max-w-xl px-5 py-20"><h1 className="text-xl font-semibold text-white">Freigabe nicht verfügbar</h1><p className="mt-3 text-sm text-[#a6a6a6]">Der Link ist ungültig, deaktiviert, abgelaufen oder momentan nicht erreichbar.</p></main>
  if (loading || !data) return <p className="p-10 text-center text-sm text-[#909090]">Freigegebene Akten werden geladen …</p>
  const permitted = selected && data.items.some(i => i.kind === selected.kind && i.recordId === selected.recordId)
  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8"><header className="mb-7 border-b border-[#343434] pb-5"><p className="mb-2 text-xs uppercase tracking-wider text-[#909090]">FIB · Freigegebene Unterlagen</p><h1 className="text-2xl font-semibold text-white">{data.title}</h1><p className="mt-2 text-sm text-[#a6a6a6]">Leseansicht · {data.items.length} freigegebene Einträge{data.expiresAt ? ` · Gültig bis ${new Date(data.expiresAt).toLocaleString('de-DE')}` : ''}</p></header>
    {permitted ? <><Button variant="outline" className="mb-5" onClick={() => setSelected(null)}>← Zur Übersicht</Button><SharedDetail key={`${selected.kind}:${selected.recordId}`} token={token} item={selected} /></> : <><Input aria-label="Freigegebene Akten durchsuchen" placeholder="Freigegebene Einträge suchen …" value={search} onChange={e => setSearch(e.target.value)} /><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.items.filter(i => i.title.toLowerCase().includes(search.toLowerCase())).map(item => <button key={`${item.kind}:${item.recordId}`} onClick={() => setSelected(item)} className="rounded-xl border border-[#343434] bg-[#141414] p-5 text-left hover:border-[#a78bfa]"><p className="text-xs text-[#c4b5fd]">{SHARE_KINDS[item.kind]}</p><h2 className="mt-2 break-words font-semibold text-white">{item.title}</h2><p className="mt-4 text-xs text-[#909090]">Eintrag öffnen →</p></button>)}</div>{!data.items.length && <p className="py-8 text-sm text-[#909090]">Aktuell sind keine Einträge verfügbar.</p>}</>}
  </main>
}
function SharedDetail({ token, item }: { token: string; item: Item }) {
  const url = `/api/shared-records/${encodeURIComponent(token)}/${item.kind}/${encodeURIComponent(item.recordId)}`
  const { data, error, loading } = useFetch<Detail>(url)
  const [videoError, setVideoError] = useState(false)
  if (error) return <p role="alert" className="text-sm text-[#a6a6a6]">Dieser Eintrag ist nicht mehr verfügbar oder nicht mehr freigegeben.</p>
  if (loading || !data) return <p className="text-sm text-[#909090]">Eintrag wird geladen …</p>
  return <article className="space-y-5 rounded-xl border border-[#343434] bg-[#141414] p-5 sm:p-7"><div><p className="text-xs text-[#c4b5fd]">{data.label}</p><h2 className="mt-2 text-xl font-semibold text-white">{data.title}</h2></div>
    {data.hasPhoto && <Image unoptimized src={`${url}/media`} alt="Aktenfoto" width={1200} height={800} className="max-h-80 w-full rounded-lg object-contain" />}
    {data.hasVideo && <><video controls playsInline preload="metadata" src={`${url}/media`} className="max-h-[65vh] w-full rounded-lg bg-black" onError={() => setVideoError(true)} />{videoError && <p className="text-sm text-[#a6a6a6]">Video nicht verfügbar oder von diesem Browser nicht unterstützt.</p>}</>}
    <dl className="space-y-4">{data.fields.map(field => <div key={field.label}><dt className="mb-1 text-xs font-semibold text-[#909090]">{field.label}</dt><dd className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#d4d4d4]">{field.value}</dd></div>)}</dl>
    {!!data.entries.length && <section className="space-y-3 border-t border-[#343434] pt-5"><h3 className="font-semibold text-white">Chronologie</h3>{data.entries.map((entry,index) => <div key={index} className="rounded-lg border border-[#343434] p-4"><p className="text-xs text-[#909090]">{entry.kind} · {new Date(entry.occurredAt).toLocaleString('de-DE')}</p><h4 className="mt-2 font-medium text-white">{entry.title}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#c4c4c4]">{entry.content}</p></div>)}</section>}
  </article>
}
