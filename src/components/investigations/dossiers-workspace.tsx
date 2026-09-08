'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams, useRouter } from 'next/navigation'
import { FolderOpen, Plus, Pencil, MapPin } from 'lucide-react'
import { DOSSIER_KINDS, type DossierKind } from '@/lib/dossiers'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { InvestigationsNavigation } from './investigations-navigation'
import { PhotoField } from './photo-catalog'
import type { Person, InvestigationListItem } from './types'

type Dossier = {
  id: string; title: string; kind: DossierKind; description: string | null; address: string | null;
  photoId: string | null; parentId: string | null; parent?: { id: string; title: string } | null;
  persons?: { id: string; firstName: string; lastName: string; personNumber: string }[];
  investigations?: { id: string; title: string; caseNumber: string }[];
  _count?: { children: number; persons: number; investigations: number };
}
type List = { items: Dossier[]; total: number }
const href = (id: string) => `/investigations/dossiers?id=${encodeURIComponent(id)}`
const photoUrl = (id: string) => `/api/investigations/photos/${id}/image`

export function DossiersWorkspace() {
  const { user } = useAuth()
  const query = useSearchParams()
  const id = query.get('id')
  if (!hasPermission(user, 'investigations:view')) return <UnauthorizedContent />
  return <DossierView key={id ?? 'root'} id={id} />
}

function DossierView({ id }: { id: string | null }) {
  const { user } = useAuth()
  const router = useRouter()
  const manage = hasPermission(user, 'investigations:manage')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const { execute, loading: saving } = useApi()
  const detail = useFetch<Dossier>(id ? `/api/investigations/dossiers/${id}` : null)
  const query = new URLSearchParams({ search, page: String(page) })
  if (id) query.set('parentId', id)
  if (kind) query.set('kind', kind)
  const list = useFetch<List>(`/api/investigations/dossiers?${query}`)
  const current = detail.data
  const refresh = () => { setEditor(null); void list.refetch(); void detail.refetch() }
  return <div>
    <PageHeader title={current?.title ?? (id ? 'Akte wird geladen …' : 'Dauerakten')} description={id ? 'Informationen, Verknüpfungen und Unterakten an einem Ort.' : 'Familienakten, Sammelakten und Anwesen dauerhaft dokumentieren.'} action={manage && <>
      {current && <Button variant="outline" onClick={() => setEditor('edit')}><Pencil size={14} />Bearbeiten</Button>}
      <Button disabled={!!id && !current} onClick={() => setEditor('new')}><Plus size={14} />{id ? 'Unterakte hinzufügen' : 'Akte anlegen'}</Button>
    </>} />
    <InvestigationsNavigation active="dossiers" />
    {id && <nav className="mb-4 flex flex-wrap gap-2 text-sm text-[#c4b5fd]" aria-label="Aktenpfad"><Link href="/investigations/dossiers">Dauerakten</Link>{current?.parent && <><span>/</span><Link href={href(current.parent.id)}>{current.parent.title}</Link></>}<span>/</span><span className="text-[#a6a6a6]">{current?.title ?? '…'}</span></nav>}
    {(message || detail.error || list.error) && <p role="alert" className="mb-4 text-sm text-red-300">{message || detail.error || list.error}</p>}
    {current && <section className="mb-6 space-y-4 rounded-xl border border-[#343434] bg-[#141414] p-5">
      <span className="rounded-md bg-[#a78bfa]/10 px-2 py-1 text-xs text-[#c4b5fd]">{DOSSIER_KINDS[current.kind]}</span>
      {current.photoId && <Image unoptimized src={photoUrl(current.photoId)} alt={current.title} width={1000} height={560} className="max-h-80 w-full rounded-lg object-contain" />}
      {current.address && <p className="flex items-center gap-2 text-sm text-[#d4d4d4]"><MapPin size={15} />{current.address}</p>}
      {current.description && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#c4c4c4]">{current.description}</p>}
      <div className="grid gap-4 sm:grid-cols-2"><div><h2 className="mb-2 text-sm font-semibold text-white">Personen / Familienmitglieder</h2>{current.persons?.length ? <ul className="space-y-1 text-sm text-[#c4b5fd]">{current.persons.map(person => <li key={person.id}><Link href={`/investigations/persons?person=${person.id}`}>{person.firstName} {person.lastName} · {person.personNumber}</Link></li>)}</ul> : <p className="text-xs text-[#808080]">Keine Personen verknüpft.</p>}</div><div><h2 className="mb-2 text-sm font-semibold text-white">Verknüpfte Einsatzakten</h2>{current.investigations?.length ? <ul className="space-y-1 text-sm text-[#c4b5fd]">{current.investigations.map(investigation => <li key={investigation.id}><Link href={`/investigations/${investigation.id}`}>{investigation.caseNumber} · {investigation.title}</Link></li>)}</ul> : <p className="text-xs text-[#808080]">Keine sichtbaren Einsatzakten verknüpft.</p>}</div></div>
      {hasPermission(user, 'investigations:delete') && <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>Akte löschen</Button>}
    </section>}
    <h2 className="mb-3 text-base font-semibold text-white">{id ? 'Unterakten' : 'Aktenübersicht'}</h2>
    <div className="mb-4 grid gap-3 sm:grid-cols-2"><Input aria-label="Akten suchen" placeholder="Akte suchen …" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /><Select value={kind} onValueChange={value => { setKind(value); setPage(1) }} options={[{ value: '', label: 'Alle Kategorien' }, ...Object.entries(DOSSIER_KINDS).map(([value, label]) => ({ value, label }))]} /></div>
    {list.loading ? <p className="py-8 text-sm text-[#808080]">Akten werden geladen …</p> : !list.data?.items.length ? <p className="py-8 text-sm text-[#808080]">Noch keine passenden Akten vorhanden.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.data.items.map(item => <Link key={item.id} href={href(item.id)} className="overflow-hidden rounded-xl border border-[#343434] bg-[#141414] hover:border-[#a78bfa]">
      {item.photoId && <Image unoptimized src={photoUrl(item.photoId)} alt={item.title} width={500} height={280} className="aspect-video w-full object-cover" />}
      <div className="space-y-2 p-4"><p className="text-xs text-[#c4b5fd]">{DOSSIER_KINDS[item.kind]}</p><h3 className="flex items-center gap-2 font-medium text-white"><FolderOpen size={17} />{item.title}</h3>{item.address && <p className="text-xs text-[#a6a6a6]">{item.address}</p>}{item.parent && !id && <p className="text-xs text-[#808080]">In {item.parent.title}</p>}<p className="text-xs text-[#808080]">{item._count?.children ?? 0} Unterakten · {item._count?.persons ?? 0} Personen</p></div>
    </Link>)}</div>}
    <div className="mt-4 flex items-center justify-between text-xs text-[#808080]"><span>{list.data?.total ?? 0} Akten · Seite {page}</span><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={page === 1 || list.loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button variant="ghost" size="sm" disabled={page * 30 >= (list.data?.total ?? 0) || list.loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>
    {editor && <DossierEditor existing={editor === 'edit' ? current ?? undefined : undefined} parent={editor === 'new' && current ? { id: current.id, title: current.title } : undefined} onClose={() => setEditor(null)} onSaved={refresh} />}
    <Modal open={deleting} onClose={() => setDeleting(false)} title="Akte löschen"><p className="mb-4 text-sm text-[#a6a6a6]">„{current?.title}“ löschen? Verknüpfte Personen und Einsatzakten bleiben bestehen. Akten mit Unterakten können nicht gelöscht werden.</p><Button variant="danger" loading={saving} onClick={async () => { try { await execute(`/api/investigations/dossiers/${id}`, { method: 'DELETE' }); router.push(current?.parentId ? href(current.parentId) : '/investigations/dossiers') } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen'); setDeleting(false) } }}>Löschen</Button></Modal>
  </div>
}

function RelationPicker({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState('')
  return <div className="space-y-2"><p className="text-sm text-[#a6a6a6]">{label}</p><div className="flex flex-wrap gap-1">{value.map(id => <Button type="button" key={id} variant="secondary" size="sm" onClick={() => onChange(value.filter(v => v !== id))}>{options.find(o => o.id === id)?.label ?? id} ×</Button>)}</div><Input placeholder={`${label} suchen …`} value={search} onChange={e => setSearch(e.target.value)} /><div className="max-h-36 overflow-y-auto">{options.filter(o => !value.includes(o.id) && o.label.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map(option => <button type="button" key={option.id} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#c4c4c4] hover:bg-[#232323]" onClick={() => onChange([...value, option.id])}>+ {option.label}</button>)}</div></div>
}

function DossierEditor({ existing, parent, onClose, onSaved }: { existing?: Dossier; parent?: { id: string; title: string }; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [kind, setKind] = useState<DossierKind>(existing?.kind ?? (parent ? 'FILE' : 'COLLECTION'))
  const [description, setDescription] = useState(existing?.description ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [photoId, setPhotoId] = useState(existing?.photoId ?? null)
  const [selectedParent, setSelectedParent] = useState<{ id: string; title: string } | null>(existing?.parent ?? parent ?? null)
  const [parentSearch, setParentSearch] = useState('')
  const [chooseParent, setChooseParent] = useState(false)
  const [personIds, setPersonIds] = useState(existing?.persons?.map(p => p.id) ?? [])
  const [investigationIds, setInvestigationIds] = useState(existing?.investigations?.map(i => i.id) ?? [])
  const [failure, setFailure] = useState('')
  const persons = useFetch<Person[]>('/api/persons')
  const cases = useFetch<InvestigationListItem[]>('/api/investigations')
  const parents = useFetch<List>(chooseParent ? `/api/investigations/dossiers?search=${encodeURIComponent(parentSearch)}` : null)
  const { execute, loading } = useApi()
  return <Modal open onClose={loading ? () => {} : onClose} title={existing ? 'Dauerakte bearbeiten' : 'Dauerakte anlegen'} size="xl"><form className="space-y-4" onSubmit={async event => { event.preventDefault(); setFailure(''); try { await execute(`/api/investigations/dossiers${existing ? `/${existing.id}` : ''}`, { method: existing ? 'PATCH' : 'POST', body: JSON.stringify({ title, kind, description: description || null, address: address || null, photoId, parentId: selectedParent?.id ?? null, personIds, investigationIds }) }); onSaved() } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen') } }}>
    <Input label="Titel" value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} placeholder="z. B. Familie Moretti" />
    <Select label="Kategorie" value={kind} onValueChange={value => setKind(value as DossierKind)} options={Object.entries(DOSSIER_KINDS).map(([value, label]) => ({ value, label }))} />
    <div className="space-y-2"><p className="text-sm text-[#a6a6a6]">Übergeordnete Akte: {selectedParent?.title ?? 'Keine · Hauptakte'}</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setChooseParent(!chooseParent)}>Übergeordnete Akte wählen</Button>{selectedParent && <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedParent(null)}>Als Hauptakte führen</Button>}</div>{chooseParent && <><Input placeholder="Akte suchen …" value={parentSearch} onChange={e => setParentSearch(e.target.value)} />{parents.error && <p role="alert" className="text-xs text-red-300">{parents.error}</p>}<div className="max-h-32 overflow-y-auto">{parents.data?.items.filter(item => item.id !== existing?.id).map(item => <button type="button" className="block w-full p-2 text-left text-sm text-[#c4b5fd] hover:bg-[#232323]" key={item.id} onClick={() => { setSelectedParent(item); setChooseParent(false) }}>{item.title}</button>)}</div></>}</div>
    <Input label="Adresse / Standort" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="z. B. Anwesen am Lake Vinewood" />
    <PhotoField value={photoId ? photoUrl(photoId) : null} onChange={photo => setPhotoId(photo?.id ?? null)} />
    <Textarea label="Informationen und Notizen" value={description} onChange={e => setDescription(e.target.value)} maxLength={30000} rows={6} placeholder="Hintergründe, Bewohner, Eigentümer, Beobachtungen …" />
    {(persons.error || cases.error) && <p role="alert" className="text-sm text-red-300">{persons.error || cases.error}</p>}
    <RelationPicker label="Personen / Familienmitglieder" options={(persons.data ?? []).map(person => ({ id: person.id, label: `${person.firstName} ${person.lastName} (${person.personNumber})` }))} value={personIds} onChange={setPersonIds} />
    <RelationPicker label="Einsatzakten" options={(cases.data ?? []).map(item => ({ id: item.id, label: `${item.caseNumber} · ${item.title}` }))} value={investigationIds} onChange={setInvestigationIds} />
    {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" loading={loading} disabled={persons.loading || cases.loading || !!persons.error || !!cases.error}>Speichern</Button></div>
  </form></Modal>
}

export function PersonDossiers({ personId }: { personId: string }) {
  const { data, error } = useFetch<List>(`/api/investigations/dossiers?personId=${personId}`)
  return <section className="space-y-2"><h3 className="text-sm font-semibold text-white">Familien-, Sammel- und Anwesenakten</h3>{error && <p className="text-xs text-red-300">{error}</p>}{data?.items.length ? <ul className="space-y-1">{data.items.map(item => <li key={item.id}><Link className="text-sm text-[#c4b5fd] hover:underline" href={href(item.id)}>{DOSSIER_KINDS[item.kind]} · {item.title}</Link></li>)}</ul> : <p className="text-xs text-[#808080]">Keine Dauerakten verknüpft.</p>}<Link className="inline-block text-xs text-[#a6a6a6] hover:text-white" href="/investigations/dossiers">Dauerakten öffnen →</Link></section>
}
