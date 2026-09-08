'use client'

import { useState } from 'react'
import { Plus, Link2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { SHARE_KINDS, type ShareKind } from '@/lib/record-share-validation'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { InvestigationsNavigation } from './investigations-navigation'

type Item = { kind: ShareKind; recordId: string; title: string; classifiedAtGrant: boolean }
type Share = { id: string; title: string; enabled: boolean; expiresAt: string | null; version: number; items: Item[] }
const itemKey = (i: Item) => `${i.kind}:${i.recordId}`
const localDate = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16) }

export function ShareManager() {
  const { user } = useAuth()
  const allowed = hasPermission(user, 'investigations:manage')
  const { data, error, loading: fetching, refetch } = useFetch<Share[]>(allowed ? '/api/record-shares' : null)
  const { execute, loading } = useApi<{ path?: string }>()
  const [editing, setEditing] = useState<Share | 'new' | null>(null)
  const [replace, setReplace] = useState<Share | null>(null)
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  if (!allowed) return <UnauthorizedContent />
  const showLink = (path: string) => { setUrl(new URL(path, window.location.origin).href); setMessage('') }
  return <div className="mx-auto max-w-6xl pb-6">
    <PageHeader title="Freigabelinks" description="Leselinks für gezielt ausgewählte Akten und Bodycams – auch ohne Dashboard-Konto." action={<Button onClick={() => setEditing('new')}><Plus size={15} />Link erstellen</Button>} />
    <InvestigationsNavigation active="shares" />
    <p className="mb-4 text-sm text-[#a6a6a6]">Jeder mit dem Link kann die gewählten Inhalte lesen. Verknüpfte Akten und Unterakten bleiben gesperrt, solange du sie nicht einzeln auswählst. Die Freigabe zeigt den aktuellen Aktenstand.</p>
    <Input label="Freigabe suchen" placeholder="Bezeichnung" value={search} onChange={e => setSearch(e.target.value)} />
    {(error || message) && <p role="status" className="my-4 text-sm text-[#c4c4c4]">{error || message}</p>}
    {fetching ? <p className="py-8 text-sm text-[#909090]">Freigaben werden geladen …</p> : <div className="mt-4 space-y-3">{(data ?? []).filter(s => s.title.toLowerCase().includes(search.toLowerCase())).map(share => <section key={share.id} className="rounded-xl border border-[#343434] bg-[#141414] p-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-white">{share.title}</h2><p className="mt-1 text-xs text-[#909090]">{!share.enabled ? 'Deaktiviert' : share.expiresAt && new Date(share.expiresAt) <= new Date() ? 'Abgelaufen' : 'Aktiv'} · {share.items.length} ausgewählte Einträge · {share.expiresAt ? `Bis ${new Date(share.expiresAt).toLocaleString('de-DE')}` : 'Ohne Ablaufdatum'}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(share)}>Auswahl bearbeiten</Button><Button variant="outline" size="sm" disabled={loading} onClick={async () => { try { await execute(`/api/record-shares/${share.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'toggle', version: share.version, enabled: !share.enabled }) }); await refetch() } catch (e) { setMessage(e instanceof Error ? e.message : 'Änderung fehlgeschlagen') } }}>{share.enabled ? 'Link deaktivieren' : 'Link aktivieren'}</Button><Button variant="ghost" size="sm" onClick={() => setReplace(share)}>Link ersetzen</Button></div></div>
      <details className="mt-3 text-xs text-[#a6a6a6]"><summary className="cursor-pointer">Freigegebene Inhalte anzeigen</summary><ul className="mt-2 space-y-1">{share.items.map(i => <li key={itemKey(i)}>{SHARE_KINDS[i.kind]} · {i.title}</li>)}</ul></details>
    </section>)}{!data?.length && <p className="py-8 text-sm text-[#909090]">Noch keine Freigabelinks erstellt.</p>}</div>}
    {editing && <ShareEditor existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={path => { setEditing(null); void refetch(); if (path) showLink(path) }} />}
    <Modal open={!!replace} onClose={loading ? () => {} : () => setReplace(null)} title="Freigabelink ersetzen"><div className="space-y-4"><p className="text-sm text-[#c4c4c4]">Für „{replace?.title}“ einen neuen Link erzeugen? Der bisherige Link wird sofort ungültig. Auswahl und Aktiv-Status bleiben erhalten.</p><Button loading={loading} onClick={async () => { try { const result = await execute(`/api/record-shares/${replace!.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'rotate', version: replace!.version }) }); setReplace(null); if (result?.path) showLink(result.path); await refetch() } catch (e) { setMessage(e instanceof Error ? e.message : 'Ersetzen fehlgeschlagen'); setReplace(null) } }}>Neuen Link erzeugen</Button></div></Modal>
    <Modal open={!!url} onClose={() => setUrl('')} title="Freigabelink erstellt"><div className="space-y-4"><p className="text-sm text-[#c4c4c4]">Diesen Link jetzt kopieren. Er wird aus Sicherheitsgründen nur einmal angezeigt. Über „Link ersetzen“ kannst du später einen neuen erzeugen.</p><Input aria-label="Freigabelink" readOnly value={url} onFocus={e => e.target.select()} /><div className="flex gap-2"><Button onClick={async () => { try { await navigator.clipboard.writeText(url); setMessage('Link kopiert.') } catch { setMessage('Bitte den Link im Textfeld markieren und kopieren.') } }}><Link2 size={14} />Kopieren</Button><a className="inline-flex items-center text-sm text-[#c4b5fd] underline" href={url} target="_blank" rel="noreferrer">Leseansicht öffnen</a></div>{message && <p role="status" className="text-sm text-[#a6a6a6]">{message}</p>}</div></Modal>
  </div>
}

function ShareEditor({ existing, onClose, onSaved }: { existing?: Share; onClose: () => void; onSaved: (path?: string) => void }) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt ? localDate(existing.expiresAt) : '')
  const [selected, setSelected] = useState<Item[]>(existing?.items ?? [])
  const [kind, setKind] = useState<ShareKind>('DOSSIER')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [failure, setFailure] = useState('')
  const { execute, loading } = useApi<{ path?: string }>()
  const candidates = useFetch<{ items: Item[]; total: number }>(`/api/record-shares/candidates?kind=${kind}&search=${encodeURIComponent(search)}&page=${page}`)
  return <Modal open onClose={loading ? () => {} : onClose} title={existing ? 'Freigabe bearbeiten' : 'Freigabelink erstellen'} size="xl"><form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); if (loading) return
    try {
      const result = await execute(`/api/record-shares${existing ? `/${existing.id}` : ''}`, { method: existing ? 'PATCH' : 'POST', body: JSON.stringify({ title, enabled, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, items: selected.map(({ kind, recordId }) => ({ kind, recordId })), ...(existing ? { version: existing.version } : {}) }) })
      onSaved(result?.path)
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Speichern fehlgeschlagen') }
  }}>
    <Input label="Bezeichnung der Freigabe" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="z. B. Unterlagen für Besprechung" />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Ablaufdatum (optional, lokale Zeit)" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /><label className="flex items-center gap-2 text-sm text-[#c4c4c4]"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Link aktiv</label></div>
    <section className="space-y-2 rounded-lg border border-[#343434] p-3"><h3 className="text-sm font-semibold text-white">{selected.length} von maximal 100 Einträgen ausgewählt</h3><p className="text-xs text-[#909090]">Nur diese Inhalte werden veröffentlicht. Fotos der gewählten Akten und die Chronologie gewählter Einsatzakten gehören dazu. Unterakten, Personen, Fahrzeuge und Clips zusätzlich auswählen.</p><div className="max-h-40 space-y-1 overflow-auto">{selected.map(item => <div key={itemKey(item)} className="flex items-center justify-between gap-2 text-xs text-[#c4c4c4]"><span>{SHARE_KINDS[item.kind]} · {item.title}{item.classifiedAtGrant ? ' · Verschlusssache' : ''}</span><Button type="button" variant="ghost" size="sm" onClick={() => setSelected(selected.filter(i => itemKey(i) !== itemKey(item)))}>Entfernen</Button></div>)}</div></section>
    {selected.some(i => i.classifiedAtGrant) && <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">Die Auswahl enthält Verschlusssachen. Diese werden über diesen Link ebenfalls ohne Anmeldung lesbar.</p>}
    <div className="grid gap-3 sm:grid-cols-2"><Select label="Bereich" value={kind} onValueChange={value => { setKind(value as ShareKind); setPage(1); setSearch('') }} options={Object.entries(SHARE_KINDS).map(([value,label]) => ({ value,label }))} /><Input label="Eintrag suchen" maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Titel, Name, Nummer oder Kennzeichen" /></div>
    {(failure || candidates.error) && <p role="alert" className="text-sm text-red-300">{failure || candidates.error}</p>}
    <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-[#343434] p-2">{candidates.loading ? <p className="p-3 text-sm text-[#909090]">Einträge werden geladen …</p> : candidates.data?.items.map(item => { const checked = selected.some(i => itemKey(i) === itemKey(item)); return <label key={itemKey(item)} className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 text-sm text-[#c4c4c4] hover:bg-[#232323]"><input type="checkbox" className="mt-1" checked={checked} disabled={!checked && selected.length >= 100} onChange={e => setSelected(e.target.checked ? [...selected, item] : selected.filter(i => itemKey(i) !== itemKey(item)))} /><span>{item.title}{item.classifiedAtGrant && <span className="ml-2 text-xs text-amber-200">Verschlusssache</span>}</span></label> })}{!candidates.loading && !candidates.data?.items.length && <p className="p-3 text-sm text-[#909090]">Keine passenden Einträge.</p>}</div>
    <div className="flex items-center justify-between gap-2 text-xs text-[#909090]"><span>{candidates.data?.total ?? 0} Treffer · Seite {page}</span><div className="flex gap-2"><Button type="button" size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Zurück</Button><Button type="button" size="sm" variant="ghost" disabled={page * 30 >= (candidates.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" loading={loading} disabled={!selected.length}>{existing ? 'Freigabe speichern' : 'Link erstellen'}</Button></div>
  </form></Modal>
}
