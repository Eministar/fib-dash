'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams, useRouter } from 'next/navigation'
import { EyeOff, FolderInput, FolderOpen, Folders, FolderSearch, ImageOff, Plus, Pencil, MapPin, Trash2 } from 'lucide-react'
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
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar, SearchInput } from '@/components/ui/filter-bar'
import { SectionCard } from '@/components/ui/section-card'
import { TabBar, resolveTab, type TabItem } from '@/components/ui/tab-bar'
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { mapCategory } from '@/lib/map-spots'
import { PhotoField } from './photo-catalog'
import { PriorityBadge, StatusBadge } from './investigation-badges'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { InvestigationPriorityKey, InvestigationStatusKey } from '@/lib/investigations'


type Dossier = {
  id: string; title: string; kind: DossierKind; description: string | null; address: string | null;
  photoId: string | null; parentId: string | null; parent?: { id: string; title: string } | null;
  updatedAt?: string; createdBy?: { displayName: string } | null;
  persons?: { id: string; firstName: string; lastName: string; personNumber: string }[];
  investigations?: { id: string; title: string; caseNumber: string; status: InvestigationStatusKey; priority: InvestigationPriorityKey; classified: boolean; updatedAt: string; createdBy?: { displayName: string } | null }[];
  vehicles?: { id: string; vehicleNumber: string; plate: string | null; model: string | null }[];
  clips?: { id: string; title: string; recordedAt: string | null }[];
  mapSpots?: PickedSpot[];
  _count?: { children: number; persons: number; investigations: number; vehicles: number; clips: number; mapSpots: number };
}

/** Die vier Aktenarten, die eine Dauerakte als Register zusammenfasst. */
type RegisterField = 'persons' | 'investigations' | 'vehicles' | 'clips';
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
  const params = useSearchParams()
  const manage = hasPermission(user, 'investigations:manage')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null)
  const [quick, setQuick] = useState<RegisterField | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const { execute, loading: saving } = useApi()
  const detail = useFetch<Dossier>(id ? `/api/investigations/dossiers/${id}` : null)
  const listQuery = new URLSearchParams({ search, page: String(page) })
  if (id) listQuery.set('parentId', id)
  if (kind) listQuery.set('kind', kind)
  const list = useFetch<List>(`/api/investigations/dossiers?${listQuery}`)
  const current = detail.data
  const refresh = () => { setEditor(null); void list.refetch(); void detail.refetch() }

  // Unterakten und Einsatzakten sind verschiedene Dinge und liegen deshalb
  // auf getrennten Reitern statt gemischt in einem Raster.
  const childCards: RegisterCardData[] = (list.data?.items ?? []).map(item => ({
    key: `d-${item.id}`, href: href(item.id), variant: 'dossier' as const,
    kind: DOSSIER_KINDS[item.kind], title: item.title, photoId: item.photoId,
    code: item.address ?? undefined,
    facts: [`${item._count?.children ?? 0} Unterakten`, `${item._count?.persons ?? 0} Personen`, `${item._count?.investigations ?? 0} Einsatzakten`],
    author: item.createdBy?.displayName, date: item.updatedAt,
  }))
  const caseCards: RegisterCardData[] = (current?.investigations ?? []).map(item => ({
    key: `i-${item.id}`, href: `/investigations/${item.id}`, variant: 'investigation' as const,
    kind: 'Einsatzakte', title: item.title, photoId: null,
    code: item.caseNumber, status: item.status, priority: item.priority, classified: item.classified,
    author: item.createdBy?.displayName, date: item.updatedAt,
  }))

  const tabs: TabItem[] = [
    { id: 'unterakten', label: 'Unterakten', count: list.data?.total ?? childCards.length },
    { id: 'einsatzakten', label: 'Einsatzakten', count: caseCards.length },
    { id: 'beteiligte', label: 'Beteiligte', count: (current?.persons?.length ?? 0) + (current?.vehicles?.length ?? 0) },
    { id: 'medien', label: 'Medien & Orte', count: (current?.clips?.length ?? 0) + (current?.mapSpots?.length ?? 0) },
  ]
  const activeTab = resolveTab(params.get('tab'), tabs)
  const selectTab = (tab: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('tab', tab)
    router.replace(`?${next}`, { scroll: false })
  }

  const factRows: [string, string][] = current ? [
    ['Übergeordnet', current.parent?.title ?? 'Hauptakte'],
    ['Unterakten', String(list.data?.total ?? 0)],
    ['Einsatzakten', String(caseCards.length)],
    ['Angelegt von', current.createdBy?.displayName ?? 'Unbekannt'],
  ] : []

  const menuItems: ActionMenuItem[] = current ? [
    { id: 'edit', label: 'Akte bearbeiten', icon: Pencil, onSelect: () => setEditor('edit') },
    { id: 'attach', label: 'Bestehende Akte einhängen', icon: FolderInput, onSelect: () => setAttaching(true) },
    ...(hasPermission(user, 'investigations:delete')
      ? [{ id: 'delete', label: 'Akte löschen', icon: Trash2, danger: true, onSelect: () => setDeleting(true) }]
      : []),
  ] : []

  return <div>
    <PageHeader
      title={current?.title ?? (id ? 'Akte wird geladen …' : 'Dauerakten')}
      description={id ? undefined : 'Familien, Sammlungen und Anwesen dauerhaft dokumentieren – über einzelne Einsätze hinweg.'}
      action={manage && <>
        {!id && <Button onClick={() => setEditor('new')}><Plus size={14} />Akte anlegen</Button>}
        {current && <>
          <Button onClick={() => setEditor('new')}><Plus size={14} />Unterakte anlegen</Button>
          <ActionMenu items={menuItems} />
        </>}
      </>}
    />
    <InvestigationsNavigation active="dossiers" />
    {id && <nav className="mb-4 flex flex-wrap gap-2 text-sm text-[#c4b5fd]" aria-label="Aktenpfad"><Link href="/investigations/dossiers">Dauerakten</Link>{current?.parent && <><span>/</span><Link href={href(current.parent.id)}>{current.parent.title}</Link></>}<span>/</span><span className="text-[#a6a6a6]">{current?.title ?? '…'}</span></nav>}
    {(message || detail.error || list.error) && <p role="alert" className="mb-4 text-sm text-red-300">{message || detail.error || list.error}</p>}

    {/* Stammdaten der Akte selbst – ohne Aktionen, die woanders hingehören. */}
    {current && <section className="mb-5 rounded-[14px] border border-[#2a2a2a] bg-[#141414] p-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-md bg-[#a78bfa]/10 px-2 py-1 text-xs text-[#c4b5fd]">{DOSSIER_KINDS[current.kind]}</span>
        {/* Der Erklärsatz stand bisher nur im Wizard – hier braucht man ihn genauso. */}
        <span className="text-[11.5px] text-[#808080]">{DOSSIER_KIND_HINTS[current.kind]}</span>
      </div>
      {current.address && <p className="mt-3 flex items-center gap-2 text-sm text-[#d4d4d4]"><MapPin size={15} />{current.address}</p>}
      {current.photoId && <Image unoptimized src={photoUrl(current.photoId)} alt={current.title} width={1000} height={560} className="mt-3 max-h-72 w-full rounded-lg object-contain" />}
      {current.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#c4c4c4]">{current.description}</p>}
      <dl className="mt-4 grid gap-x-6 gap-y-2.5 border-t border-[#232323] pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {factRows.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">{label}</dt>
          <dd className="mt-0.5 truncate text-[12.5px] text-[#d4d4d4]" title={value}>{value}</dd>
        </div>)}
      </dl>
    </section>}

    {id ? <>
      <TabBar tabs={tabs} active={activeTab} onSelect={selectTab} label="Bereiche der Dauerakte" />

      {activeTab === 'unterakten' && <SectionCard
        title="Unterakten"
        count={childCards.length}
        empty="Noch keine Unterakten. Eine Unterakte gliedert eine große Akte – etwa ein Anwesen innerhalb einer Familienakte."
        action={manage && current ? <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAttaching(true)}><FolderInput size={13} />Bestehende einhängen</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditor('new')}><Plus size={13} />Unterakte anlegen</Button>
        </div> : null}
      >
        {list.loading
          ? <p className="py-6 text-sm text-[#808080]">Unterakten werden geladen …</p>
          : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{childCards.map(card => <RegisterCard key={card.key} card={card} />)}</div>
            {(list.data?.total ?? 0) > 30 && <div className="mt-4 flex items-center justify-between text-xs text-[#808080]"><span>Seite {page}</span><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={page === 1 || list.loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button variant="ghost" size="sm" disabled={page * 30 >= (list.data?.total ?? 0) || list.loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>}
          </>}
      </SectionCard>}

      {activeTab === 'einsatzakten' && <SectionCard
        title="Einsatzakten"
        count={caseCards.length}
        empty="Keine Einsatzakten verknüpft. Hier stehen die einzelnen Einsätze, die zu dieser Akte gehören."
        action={manage && current ? <Button size="sm" variant="ghost" onClick={() => setQuick('investigations')}><Plus size={13} />Einsatzakte verknüpfen</Button> : null}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{caseCards.map(card => <RegisterCard key={card.key} card={card} />)}</div>
      </SectionCard>}

      {activeTab === 'beteiligte' && current && <>
        <SectionCard title="Personen / Familienmitglieder" count={current.persons?.length ?? 0} empty="Keine Personen verknüpft."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('persons')}><Plus size={13} />Verknüpfen</Button> : null}>
          <RegisterList entries={current.persons?.map(person => ({ id: person.id, href: `/investigations/persons?person=${person.id}`, label: `${person.firstName} ${person.lastName}`, hint: person.personNumber }))} />
        </SectionCard>
        <SectionCard title="Fahrzeugakten" count={current.vehicles?.length ?? 0} empty="Keine Fahrzeuge verknüpft."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('vehicles')}><Plus size={13} />Verknüpfen</Button> : null}>
          <RegisterList entries={current.vehicles?.map(vehicle => ({ id: vehicle.id, href: '/investigations/vehicles', label: [vehicle.plate, vehicle.model].filter(Boolean).join(' · ') || vehicle.vehicleNumber, hint: vehicle.vehicleNumber }))} />
        </SectionCard>
      </>}

      {activeTab === 'medien' && current && <>
        <SectionCard title="Bodycams" count={current.clips?.length ?? 0} empty="Keine sichtbaren Bodycams verknüpft."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('clips')}><Plus size={13} />Verknüpfen</Button> : null}>
          <RegisterList entries={current.clips?.map(clip => ({ id: clip.id, href: '/investigations/clips', label: clip.title, hint: clip.recordedAt ? new Date(clip.recordedAt).toLocaleDateString('de-DE') : undefined }))} />
        </SectionCard>
        <SectionCard title="Kartenpunkte" count={current.mapSpots?.length ?? 0} empty="Keine Kartenpunkte verknüpft – hier stehen die Routen, Sammler und Anwesen dieser Akte."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setEditor('edit')}><Plus size={13} />Verknüpfen</Button> : null}>
          <ul className="flex flex-wrap gap-1.5">
            {current.mapSpots?.map(spot => <li key={spot.id}>
              <Link href="/map" className="flex items-center gap-1.5 rounded-full border border-[#343434] px-3 py-1.5 text-[12px] text-[#d4d4d4] hover:border-[#a78bfa]">
                <span className="h-2 w-2 rounded-full" style={{ background: mapCategory(spot.category).hex }} />
                {spot.title}
                <span className="text-[#6a6a6a]">{mapCategory(spot.category).label}</span>
              </Link>
            </li>)}
          </ul>
        </SectionCard>
      </>}
    </> : <>
      <FilterBar>
        <SearchInput value={search} onChange={value => { setSearch(value); setPage(1) }} label="Dauerakte suchen" placeholder="Akte nach Titel oder Adresse suchen …" />
        <Select value={kind} onValueChange={value => { setKind(value); setPage(1) }} options={[{ value: '', label: 'Alle Kategorien' }, ...Object.entries(DOSSIER_KINDS).map(([value, label]) => ({ value, label }))]} />
      </FilterBar>
      {list.loading ? <p className="py-8 text-sm text-[#808080]">Akten werden geladen …</p>
        : !list.data?.items.length ? <EmptyState
            icon={Folders}
            title={search || kind ? 'Keine Akte passt zu diesem Filter.' : 'Noch keine Dauerakten.'}
            hint={search || kind
              ? 'Andere Schreibweise probieren oder den Filter zurücksetzen.'
              : 'Eine Dauerakte bündelt alles, was über einzelne Einsätze hinaus zu einer Familie, einem Anwesen oder einem Thema bekannt ist.'}
            action={search || kind
              ? <Button variant="outline" onClick={() => { setSearch(''); setKind(''); setPage(1) }}>Filter zurücksetzen</Button>
              : manage ? <Button onClick={() => setEditor('new')}><Plus size={14} />Akte anlegen</Button> : null}
          />
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{list.data.items.map(item => <RegisterCard key={item.id} card={{
            key: item.id, href: href(item.id), variant: 'dossier', kind: DOSSIER_KINDS[item.kind], title: item.title, photoId: item.photoId,
            code: item.address ?? undefined, parentTitle: item.parent?.title,
            facts: [`${item._count?.children ?? 0} Unterakten`, `${item._count?.persons ?? 0} Personen`, `${item._count?.investigations ?? 0} Einsatzakten`],
            author: item.createdBy?.displayName, date: item.updatedAt,
          }} />)}</div>}
      {(list.data?.items.length ?? 0) > 0 && <div className="mt-4 flex items-center justify-between text-xs text-[#808080]"><span>{list.data?.total ?? 0} Akten · Seite {page}</span><div className="flex gap-2"><Button variant="ghost" size="sm" disabled={page === 1 || list.loading} onClick={() => setPage(page - 1)}>Zurück</Button><Button variant="ghost" size="sm" disabled={page * 30 >= (list.data?.total ?? 0) || list.loading} onClick={() => setPage(page + 1)}>Weiter</Button></div></div>}
    </>}

    {editor && <DossierEditor existing={editor === 'edit' ? current ?? undefined : undefined} parent={editor === 'new' && current ? { id: current.id, title: current.title } : undefined} onClose={() => setEditor(null)} onSaved={refresh} />}
    {quick && current && <QuickRelationEditor dossier={current} field={quick} onClose={() => setQuick(null)} onSaved={refresh} />}
    {attaching && current && <AttachExistingDossier dossier={current} onClose={() => setAttaching(false)} onSaved={() => { setAttaching(false); refresh() }} />}
    <Modal open={deleting} onClose={() => setDeleting(false)} title="Akte löschen"><p className="mb-4 text-sm text-[#a6a6a6]">„{current?.title}“ löschen? Verknüpfte Personen, Einsatzakten, Fahrzeuge und Bodycams bleiben bestehen. Akten, unter denen weitere Akten hängen, können nicht gelöscht werden.</p><Button variant="danger" loading={saving} onClick={async () => { try { await execute(`/api/investigations/dossiers/${id}`, { method: 'DELETE' }); router.push(current?.parentId ? href(current.parentId) : '/investigations/dossiers') } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen'); setDeleting(false) } }}>Löschen</Button></Modal>
  </div>
}

type RegisterCardData = {
  key: string; href: string; variant: 'dossier' | 'investigation'
  kind: string; title: string; photoId: string | null
  /** Aktenzeichen bei Einsatzakten, Adresse bei Dauerakten. */
  code?: string
  parentTitle?: string
  status?: InvestigationStatusKey; priority?: InvestigationPriorityKey; classified?: boolean
  facts?: string[]
  author?: string; date?: string
}

/**
 * Einheitliche Kachel fuer beide Aktenarten. Feste Bildhoehe und eine an den
 * unteren Rand gedrueckte Fusszeile halten alle Kacheln gleich hoch – sonst
 * reisst eine einzige Akte mit Bild die ganze Zeile auseinander.
 */
function RegisterCard({ card }: { card: RegisterCardData }) {
  const Icon = card.variant === 'investigation' ? FolderSearch : FolderOpen
  return <Link href={card.href} className="group flex flex-col overflow-hidden rounded-xl border border-[#343434] bg-[#141414] transition-colors hover:border-[#a78bfa]">
    <div className="relative h-28 shrink-0 overflow-hidden border-b border-[#232323] bg-[#111111]">
      {card.photoId
        ? <Image unoptimized src={photoUrl(card.photoId)} alt="" width={480} height={224} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        : <span className="flex h-full w-full items-center justify-center text-[#2f2f2f]"><ImageOff size={22} /></span>}
      <span className="absolute left-2 top-2 rounded-md bg-[#0b0b0b]/85 px-2 py-0.5 text-[10.5px] font-medium text-[#c4b5fd] backdrop-blur">{card.kind}</span>
    </div>

    <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
      <h3 className="flex items-start gap-2 text-[13.5px] font-medium leading-snug text-white">
        <Icon size={15} className="mt-0.5 shrink-0 text-[#808080]" />
        <span className="line-clamp-2">{card.title}</span>
      </h3>

      {(card.status || card.classified) && <div className="flex flex-wrap gap-1.5">
        {card.status && <StatusBadge status={card.status} />}
        {card.priority && <PriorityBadge priority={card.priority} />}
        {card.classified && <Badge variant="danger" className="gap-1"><EyeOff className="h-3 w-3" />Verschluss</Badge>}
      </div>}

      {card.code && <p className="truncate font-mono text-[11px] text-[#d4af37]">{card.code}</p>}
      {card.parentTitle && <p className="truncate text-[11px] text-[#808080]">In {card.parentTitle}</p>}
      {card.facts?.length ? <p className="truncate text-[11px] text-[#808080]">{card.facts.join(' · ')}</p> : null}

      {(card.author || card.date) && <p className="mt-auto truncate border-t border-[#232323] pt-2 text-[10.5px] text-[#6a6a6a]">
        {[card.author, card.date ? formatDate(card.date) : null].filter(Boolean).join(' · ')}
      </p>}
    </div>
  </Link>
}

/** Eine Rubrik des Registers: Überschrift, Hinzufügen-Knopf, Einträge. */
/** Reine Liste – Titel, Zähler und Aktion liefert die umgebende SectionCard. */
function RegisterList({ entries }: { entries?: { id: string; href: string; label: string; hint?: string }[] }) {
  if (!entries?.length) return null
  return <ul className="divide-y divide-[#232323] text-sm">
    {entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link className="text-[#c4b5fd] hover:underline" href={entry.href}>{entry.label}</Link>
      {entry.hint && <span className="font-mono text-xs text-[#808080]">{entry.hint}</span>}
    </li>)}
  </ul>
}

function RelationPicker({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState('')
  return <div className="space-y-2"><p className="text-sm text-[#a6a6a6]">{label}</p><div className="flex flex-wrap gap-1">{value.map(id => <Button type="button" key={id} variant="secondary" size="sm" onClick={() => onChange(value.filter(v => v !== id))}>{options.find(o => o.id === id)?.label ?? id} ×</Button>)}</div><Input placeholder={`${label} suchen …`} value={search} onChange={e => setSearch(e.target.value)} /><div className="max-h-36 overflow-y-auto">{options.filter(o => !value.includes(o.id) && o.label.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map(option => <button type="button" key={option.id} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#c4c4c4] hover:bg-[#232323]" onClick={() => onChange([...value, option.id])}>+ {option.label}</button>)}</div></div>
}

/** Kurzerklärungen für die Kategorieauswahl im Wizard. Die reinen Labels
 *  aus `DOSSIER_KINDS` sagen nicht, wofür man welche Art nimmt. */
const DOSSIER_KIND_HINTS: Record<DossierKind, string> = {
  FAMILY: 'Eine Familie oder Organisation mit ihren Mitgliedern, Routen und Sammlern.',
  COLLECTION: 'Eine offene Sammlung, die mehrere Akten unter einem Thema bündelt.',
  PROPERTY: 'Ein Anwesen oder Objekt mit Adresse, Bewohnern und Beobachtungen.',
  FILE: 'Eine Unterakte innerhalb einer übergeordneten Akte.',
}

function DossierEditor({ existing, parent, onClose, onSaved }: { existing?: Dossier; parent?: { id: string; title: string }; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
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
  const [vehicleIds, setVehicleIds] = useState(existing?.vehicles?.map(v => v.id) ?? [])
  const [clipIds, setClipIds] = useState(existing?.clips?.map(c => c.id) ?? [])
  const [mapSpots, setMapSpots] = useState<PickedSpot[]>(existing?.mapSpots ?? [])
  const [failure, setFailure] = useState('')
  const persons = useRegisterOptions('persons')
  const cases = useRegisterOptions('investigations')
  const vehicles = useRegisterOptions('vehicles')
  const clips = useRegisterOptions('clips')
  const optionsLoading = persons.loading || cases.loading || vehicles.loading || clips.loading
  const optionsError = persons.error || cases.error || vehicles.error || clips.error
  const parents = useFetch<List>(chooseParent ? `/api/investigations/dossiers?search=${encodeURIComponent(parentSearch)}` : null)
  const { execute, loading } = useApi()

  const save = async () => {
    setFailure('')
    try {
      await execute(`/api/investigations/dossiers${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title, kind,
          description: description || null,
          address: address || null,
          photoId,
          parentId: selectedParent?.id ?? null,
          personIds, investigationIds, vehicleIds, clipIds,
          mapSpotIds: mapSpots.map(spot => spot.id),
        }),
      })
      onSaved()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen')
    }
  }

  const steps: WizardStep[] = [
    {
      id: 'art',
      label: 'Art & Titel',
      invalid: title.trim() ? undefined : 'Bitte einen Titel für die Akte angeben.',
      content: <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(DOSSIER_KINDS).map(([value, label]) => <button type="button" key={value} onClick={() => setKind(value as DossierKind)} aria-pressed={kind === value}
            className={`rounded-[10px] border p-3 text-left ${kind === value ? 'border-[#a78bfa] bg-[#a78bfa]/10' : 'border-[#282828] hover:border-[#404040]'}`}>
            <span className="block text-[13px] font-medium text-white">{label}</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[#808080]">{DOSSIER_KIND_HINTS[value as DossierKind]}</span>
          </button>)}
        </div>
        <Input label="Titel" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="z. B. Familie Moretti" />
        <div className="space-y-2">
          <p className="text-sm text-[#a6a6a6]">Übergeordnete Akte: {selectedParent?.title ?? 'Keine · Hauptakte'}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setChooseParent(!chooseParent)}>Übergeordnete Akte wählen</Button>
            {selectedParent && <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedParent(null)}>Als Hauptakte führen</Button>}
          </div>
          {chooseParent && <>
            <Input placeholder="Akte suchen …" value={parentSearch} onChange={e => setParentSearch(e.target.value)} />
            {parents.error && <p role="alert" className="text-xs text-red-300">{parents.error}</p>}
            <div className="max-h-32 overflow-y-auto">{parents.data?.items.filter(item => item.id !== existing?.id).map(item => <button type="button" className="block w-full p-2 text-left text-sm text-[#c4b5fd] hover:bg-[#232323]" key={item.id} onClick={() => { setSelectedParent(item); setChooseParent(false) }}>{item.title}</button>)}</div>
          </>}
        </div>
      </div>,
    },
    {
      id: 'beschreibung',
      label: 'Beschreibung',
      optional: true,
      content: <div className="space-y-4">
        <Input label="Adresse / Standort" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="z. B. Anwesen am Lake Vinewood" />
        <PhotoField value={photoId ? photoUrl(photoId) : null} onChange={photo => setPhotoId(photo?.id ?? null)} />
        <Textarea label="Informationen und Notizen" value={description} onChange={e => setDescription(e.target.value)} maxLength={30000} rows={6} placeholder="Hintergründe, Bewohner, Eigentümer, Beobachtungen …" />
      </div>,
    },
    {
      id: 'karte',
      label: 'Kartenpunkte',
      optional: true,
      content: <div className="space-y-3">
        <p className="text-[12.5px] text-[#a6a6a6]">Routen, Sammler und Anwesen, die zu dieser Akte gehören.</p>
        <SpotPickerField value={mapSpots} onChange={setMapSpots} canCreate={hasPermission(user, 'map:manage')} />
      </div>,
    },
    {
      id: 'verknuepfungen',
      label: 'Verknüpfungen',
      optional: true,
      content: <div className="space-y-4">
        {optionsError && <p role="alert" className="text-sm text-red-300">{optionsError}</p>}
        <RelationPicker label="Personen / Familienmitglieder" options={persons.options} value={personIds} onChange={setPersonIds} />
        <RelationPicker label="Einsatzakten" options={cases.options} value={investigationIds} onChange={setInvestigationIds} />
        <RelationPicker label="Fahrzeugakten" options={vehicles.options} value={vehicleIds} onChange={setVehicleIds} />
        <RelationPicker label="Bodycams" options={clips.options} value={clipIds} onChange={setClipIds} />
      </div>,
    },
    {
      id: 'pruefen',
      label: 'Prüfen',
      content: <dl className="grid gap-2.5 text-[12.5px]">
        {([
          ['Kategorie', DOSSIER_KINDS[kind]],
          ['Titel', title || '—'],
          ['Übergeordnet', selectedParent?.title ?? 'Hauptakte'],
          ['Adresse', address || '—'],
          ['Kartenpunkte', mapSpots.length ? mapSpots.map(spot => spot.title).join(', ') : 'Keine'],
          ['Personen', String(personIds.length)],
          ['Einsatzakten', String(investigationIds.length)],
          ['Fahrzeuge', String(vehicleIds.length)],
          ['Bodycams', String(clipIds.length)],
        ] as [string, string][]).map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1e1e1e] pb-2">
          <dt className="w-36 shrink-0 text-[#808080]">{label}</dt>
          <dd className="min-w-0 text-[#d4d4d4]">{value}</dd>
        </div>)}
      </dl>,
    },
  ]

  return <Modal open onClose={loading ? () => {} : onClose} title={existing ? 'Dauerakte bearbeiten' : 'Dauerakte anlegen'} size="xl">
    <Wizard
      steps={steps}
      // Beim Bearbeiten darf jeder Schritt direkt angesprungen werden.
      mode={existing ? 'free' : 'linear'}
      submitLabel="Speichern"
      saving={loading || optionsLoading}
      failure={failure}
      onCancel={onClose}
      onSubmit={save}
    />
  </Modal>
}

/** Auswahl einer bestehenden Dauerakte. Ohne Suchbegriff liefert die API nur
 *  Hauptakten – deshalb der Hinweis im Platzhalter. */
function DossierPicker({ title, excludeIds, busy, failure, onPick, onClose }: { title: string; excludeIds: string[]; busy: boolean; failure?: string; onPick: (dossier: Dossier) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const list = useFetch<List>(`/api/investigations/dossiers?search=${encodeURIComponent(search)}`)
  const options = (list.data?.items ?? []).filter(item => !excludeIds.includes(item.id))
  return <Modal open onClose={busy ? () => {} : onClose} title={title} size="lg">
    <div className="space-y-3">
      <Input aria-label="Dauerakte suchen" placeholder="Akte suchen … (leer = nur Hauptakten)" value={search} onChange={e => setSearch(e.target.value)} />
      {(failure || list.error) && <p role="alert" className="text-sm text-red-300">{failure || list.error}</p>}
      {list.loading ? <p className="text-sm text-[#808080]">Akten werden geladen …</p> : !options.length ? <p className="text-sm text-[#808080]">Keine passende Akte gefunden.</p> : <ul className="max-h-72 space-y-1 overflow-y-auto">{options.map(item => <li key={item.id}><button type="button" disabled={busy} className="block w-full rounded px-2 py-2 text-left text-sm text-[#c4b5fd] hover:bg-[#232323] disabled:opacity-50" onClick={() => onPick(item)}>{DOSSIER_KINDS[item.kind]} · {item.title}{item.parent ? <span className="text-[#808080]"> · in {item.parent.title}</span> : null}</button></li>)}</ul>}
      <div className="flex justify-end border-t border-[#232323] pt-3"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Abbrechen</Button></div>
    </div>
  </Modal>
}

/** Dauerakten, in denen dieser Datensatz steckt – inklusive Hinzufügen/Entfernen.
 *  Die Dossier-API ersetzt Relationen als Ganzes, deshalb wird die Zielakte vor
 *  dem Speichern gelesen und die Liste nur um diesen einen Eintrag verändert. */
function LinkedDossiers({ relation, recordId, heading }: { relation: 'person' | 'investigation'; recordId: string; heading: string }) {
  const { user } = useAuth()
  const manage = hasPermission(user, 'investigations:manage')
  const filter = relation === 'person' ? 'personId' : 'investigationId'
  const { data, error, refetch } = useFetch<List>(`/api/investigations/dossiers?${filter}=${encodeURIComponent(recordId)}`)
  const [picking, setPicking] = useState(false)
  const [failure, setFailure] = useState('')
  const { execute, loading } = useApi<Dossier>()
  const linked = data?.items ?? []

  const setMembership = async (dossierId: string, member: boolean) => {
    setFailure('')
    try {
      const target = await execute(`/api/investigations/dossiers/${dossierId}`)
      const current = (relation === 'person' ? target?.persons : target?.investigations)?.map(entry => entry.id) ?? []
      const next = member ? [...new Set([...current, recordId])] : current.filter(entry => entry !== recordId)
      await execute(`/api/investigations/dossiers/${dossierId}`, { method: 'PATCH', body: JSON.stringify(relation === 'person' ? { personIds: next } : { investigationIds: next }) })
      setPicking(false)
      await refetch()
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Verknüpfung fehlgeschlagen') }
  }

  return <section className="space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">{heading}</h3>{manage && <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}><Plus size={13} />Zu Dauerakte hinzufügen</Button>}</div>
    {(error || failure) && <p role="alert" className="text-xs text-red-300">{failure || error}</p>}
    {linked.length ? <ul className="space-y-1">{linked.map(item => <li key={item.id} className="flex items-center gap-2">
      <Link className="text-sm text-[#c4b5fd] hover:underline" href={href(item.id)}>{DOSSIER_KINDS[item.kind]} · {item.title}</Link>
      {manage && <button type="button" disabled={loading} className="text-xs text-[#808080] hover:text-red-300 disabled:opacity-50" aria-label={`${item.title} entfernen`} onClick={() => setMembership(item.id, false)}>Entfernen</button>}
    </li>)}</ul> : <p className="text-xs text-[#808080]">Keine Dauerakten verknüpft.</p>}
    <Link className="inline-block text-xs text-[#a6a6a6] hover:text-white" href="/investigations/dossiers">Dauerakten öffnen →</Link>
    {picking && <DossierPicker title="Zu welcher Dauerakte hinzufügen?" excludeIds={linked.map(item => item.id)} busy={loading} failure={failure} onPick={dossier => setMembership(dossier.id, true)} onClose={() => setPicking(false)} />}
  </section>
}

/**
 * Beschreibt eine Registerrubrik einmal zentral: woher die Auswahl kommt, wie
 * ein Eintrag heißt und unter welchem Feld die API sie erwartet. Editor und
 * Schnellzuordnung greifen beide darauf zu, damit die vier Aktenarten nicht
 * an zwei Stellen getrennt gepflegt werden müssen.
 */
const REGISTER_FIELDS: Record<RegisterField, { label: string; endpoint: string; payloadKey: string }> = {
  persons: { label: 'Personen / Familienmitglieder', endpoint: '/api/persons', payloadKey: 'personIds' },
  investigations: { label: 'Einsatzakten', endpoint: '/api/investigations', payloadKey: 'investigationIds' },
  vehicles: { label: 'Fahrzeugakten', endpoint: '/api/vehicles', payloadKey: 'vehicleIds' },
  clips: { label: 'Bodycams', endpoint: '/api/investigations/clips', payloadKey: 'clipIds' },
}

type RegisterRow = { id: string; firstName?: string; lastName?: string; personNumber?: string; caseNumber?: string; title?: string; vehicleNumber?: string; plate?: string | null; model?: string | null; recordedAt?: string | null }

function registerLabel(field: RegisterField, row: RegisterRow): string {
  if (field === 'persons') return `${row.firstName} ${row.lastName} (${row.personNumber})`
  if (field === 'investigations') return `${row.caseNumber} · ${row.title}`
  if (field === 'vehicles') return `${[row.plate, row.model].filter(Boolean).join(' · ') || row.vehicleNumber} (${row.vehicleNumber})`
  return row.recordedAt ? `${row.title} · ${new Date(row.recordedAt).toLocaleDateString('de-DE')}` : (row.title ?? row.id)
}

function currentIds(dossier: Dossier, field: RegisterField): string[] {
  const entries = field === 'persons' ? dossier.persons : field === 'investigations' ? dossier.investigations : field === 'vehicles' ? dossier.vehicles : dossier.clips
  return entries?.map(entry => entry.id) ?? []
}

/** Lädt die Auswahl einer Rubrik. `null` als Feld hält den Request zurück. */
function useRegisterOptions(field: RegisterField | null) {
  const { data, loading, error } = useFetch<RegisterRow[]>(field ? REGISTER_FIELDS[field].endpoint : null)
  return { options: field ? (data ?? []).map(row => ({ id: row.id, label: registerLabel(field, row) })) : [], loading, error }
}

/** Ergänzt eine einzelne Registerrubrik, ohne den vollen Editor zu öffnen. */
function QuickRelationEditor({ dossier, field, onClose, onSaved }: { dossier: Dossier; field: RegisterField; onClose: () => void; onSaved: () => void }) {
  const [ids, setIds] = useState(() => currentIds(dossier, field))
  const [failure, setFailure] = useState('')
  const { options, loading: optionsLoading, error: optionsError } = useRegisterOptions(field)
  const { execute, loading } = useApi()
  return <Modal open onClose={loading ? () => {} : onClose} title={`${REGISTER_FIELDS[field].label} verknüpfen`} size="lg">
    <form className="space-y-4" onSubmit={async event => { event.preventDefault(); setFailure(''); try { await execute(`/api/investigations/dossiers/${dossier.id}`, { method: 'PATCH', body: JSON.stringify({ [REGISTER_FIELDS[field].payloadKey]: ids }) }); onSaved() } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen') } }}>
      {optionsError && <p role="alert" className="text-sm text-red-300">{optionsError}</p>}
      <RelationPicker label={REGISTER_FIELDS[field].label} options={options} value={ids} onChange={setIds} />
      {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" loading={loading} disabled={optionsLoading || !!optionsError}>Speichern</Button></div>
    </form>
  </Modal>
}

/** Hängt eine bereits bestehende Dauerakte unter die aktuelle. Zyklen und
 *  Tiefenlimit prüft `validateDossierParent` serverseitig. */
function AttachExistingDossier({ dossier, onClose, onSaved }: { dossier: Dossier; onClose: () => void; onSaved: () => void }) {
  const [failure, setFailure] = useState('')
  const { execute, loading } = useApi()
  return <DossierPicker
    title={`Bestehende Akte unter „${dossier.title}“ einhängen`}
    excludeIds={[dossier.id]}
    busy={loading}
    failure={failure}
    onClose={onClose}
    onPick={async child => { setFailure(''); try { await execute(`/api/investigations/dossiers/${child.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: dossier.id }) }); onSaved() } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'Einhängen fehlgeschlagen') } }}
  />
}

export function PersonDossiers({ personId }: { personId: string }) {
  return <LinkedDossiers relation="person" recordId={personId} heading="Familien-, Sammel- und Anwesenakten" />
}

export function InvestigationDossiers({ investigationId }: { investigationId: string }) {
  return <LinkedDossiers relation="investigation" recordId={investigationId} heading="Dauerakten" />
}
