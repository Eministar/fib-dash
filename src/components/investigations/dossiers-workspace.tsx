'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams, useRouter } from 'next/navigation'
import { Car, Crown, Folders, Image as ImageIcon, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { DOSSIER_LABEL, DOSSIER_LABEL_PLURAL, DOSSIER_REGISTER_LABEL, DOSSIER_SORTS, OPEN_INVESTIGATION_STATUSES, type DossierSort } from '@/lib/investigations/dossiers'
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
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { mapCategory } from '@/lib/investigations/map-spots'
import { PhotoField, PhotoPicker, type CatalogPhoto } from './photo-catalog'
import { ImageLightbox, LightboxThumb } from '@/components/ui/image-lightbox'
import { PriorityBadge, StatusBadge } from './investigation-badges'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'
import type { InvestigationPriorityKey, InvestigationStatusKey } from '@/lib/investigations/investigations'
import { useUrlState } from '@/hooks/use-url-state'
import { useTrackRecentItem } from '@/hooks/use-recent-items'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ListSkeleton } from '@/components/ui/loading'

type PersonRef = { id: string; firstName: string; lastName: string; personNumber?: string }

type Dossier = {
  id: string; title: string; description: string | null; address: string | null;
  photoId: string | null; photos?: { id: string; title: string; description?: string | null }[];
  leaderId?: string | null; leader?: PersonRef | null;
  updatedAt?: string; lastActivityAt?: string; openInvestigations?: number;
  createdBy?: { displayName: string } | null;
  persons?: (PersonRef & { personNumber: string })[];
  investigations?: { id: string; title: string; caseNumber: string; status: InvestigationStatusKey; priority: InvestigationPriorityKey; updatedAt: string; createdBy?: { displayName: string } | null }[];
  vehicles?: { id: string; vehicleNumber: string; plate: string | null; model: string | null }[];
  mapSpots?: PickedSpot[];
  _count?: { persons: number; investigations: number; vehicles: number; mapSpots: number };
}

/** Die drei Aktenarten, die eine Familienakte als Register zusammenfasst. */
type RegisterField = 'persons' | 'investigations' | 'vehicles'
type List = { items: Dossier[]; total: number }
const PAGE_SIZE = 30
const href = (id: string) => `/investigations/dossiers?id=${encodeURIComponent(id)}`
const photoUrl = (id: string) => `/api/investigations/photos/${id}/image`
const personName = (person: PersonRef) => `${person.firstName} ${person.lastName}`
const isOpen = (status: InvestigationStatusKey) => (OPEN_INVESTIGATION_STATUSES as readonly string[]).includes(status)

export function DossiersWorkspace() {
  const { user } = useAuth()
  const query = useSearchParams()
  const id = query.get('id')
  if (!hasPermission(user, 'investigations:view')) return <UnauthorizedContent />
  return <DossierView key={id ?? 'root'} id={id} />
}

function DossierView({ id }: { id: string | null }) {
  const { user } = useAuth()
  const params = useSearchParams()
  const manage = hasPermission(user, 'investigations:manage')
  const [editor, setEditor] = useState<'new' | 'edit' | null>(manage && params.get('new') === '1' ? 'new' : null)
  const detail = useFetch<Dossier>(id ? `/api/investigations/dossiers/${id}` : null)
  useTrackRecentItem(id && detail.data ? {
    href: `/investigations/dossiers?id=${encodeURIComponent(id)}`,
    title: detail.data.title,
    kind: 'dossier',
  } : null)

  return <div>
    {id
      ? <DossierDetail id={id} dossier={detail.data} error={detail.error} manage={manage} onEdit={() => setEditor('edit')} onChanged={() => void detail.refetch()} />
      : <DossierRegister manage={manage} onCreate={() => setEditor('new')} />}
    {editor && <DossierEditor existing={editor === 'edit' ? detail.data ?? undefined : undefined} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void detail.refetch() }} />}
  </div>
}

/* ── Familienregister: kompakte Liste aller Familien ───────────────── */

function DossierRegister({ manage, onCreate }: { manage: boolean; onCreate: () => void }) {
  const [search, setSearch] = useUrlState('q', '')
  const [sort, setSort] = useUrlState<DossierSort>('sort', 'activity', ['activity', 'open', 'name'])
  const debouncedSearch = useDebouncedValue(search)
  const [page, setPage] = useState(1)
  const list = useFetch<List>(`/api/investigations/dossiers?${new URLSearchParams({ search: debouncedSearch, sort, page: String(page) })}`)
  const items = list.data?.items ?? []
  const pageCount = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))

  return <>
    <PageHeader
      title={DOSSIER_REGISTER_LABEL}
      description="Jede Familie mit Fraktionsleiter, Anwesen, Mitgliedern und allen Einsatzakten."
      action={manage && <Button onClick={onCreate}><Plus size={14} />Familienakte anlegen</Button>}
    />
    <InvestigationsNavigation active="dossiers" />
    <FilterBar>
      <SearchInput value={search} onChange={value => { setSearch(value); setPage(1) }} label="Familienregister durchsuchen" placeholder="Familie, Leiter, Mitglied oder Adresse suchen …" />
      <Select aria-label="Sortierung" value={sort} onValueChange={value => { setSort(value as DossierSort); setPage(1) }} options={Object.entries(DOSSIER_SORTS).map(([value, label]) => ({ value, label: `Sortiert nach: ${label}` }))} />
    </FilterBar>
    {list.error && <p role="alert" className="mb-4 text-sm text-[#fca5a5]">{list.error}</p>}

    {list.loading && !list.data ? <ListSkeleton />
      : !items.length ? <EmptyState
          icon={Folders}
          title={search ? 'Keine Familie passt zu dieser Suche.' : 'Noch keine Familienakten.'}
          hint={search ? 'Andere Schreibweise probieren oder die Suche leeren.' : 'Eine Familienakte bündelt alles zu einer Familie oder Fraktion: Leiter, Anwesen, Mitglieder und alle Einsatzakten.'}
          action={search
            ? <Button variant="outline" onClick={() => { setSearch(''); setPage(1) }}>Suche leeren</Button>
            : manage ? <Button onClick={onCreate}><Plus size={14} />Familienakte anlegen</Button> : null}
        />
      : <div className="overflow-hidden rounded-[12px] border border-[#38383a]">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_110px] gap-4 border-b border-[#38383a] bg-[#1c1c1e] px-4 py-2.5 text-[12px] text-[#8e8e93] md:grid">
          <span>Familie</span><span>Fraktionsleiter</span><span>Anwesen</span><span>Akten</span><span>Aktiv</span>
        </div>
        <ul>
          {items.map(item => <li key={item.id} className="border-b border-[#2c2c2e] last:border-0">
            <Link href={href(item.id)} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-[#1c1c1e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a78bfa] md:grid-cols-[40px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_110px] md:gap-4">
              <FamilyThumb photoId={item.photoId} />
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-white">{item.title}</p>
                <p className="truncate text-[12px] text-[#8e8e93] md:hidden">
                  {[item.leader ? personName(item.leader) : null, item.address].filter(Boolean).join(' · ') || 'Kein Leiter, kein Anwesen'}
                </p>
                <p className="text-[12px] text-[#8e8e93] md:hidden"><OpenCount open={item.openInvestigations ?? 0} total={item._count?.investigations ?? 0} /></p>
              </div>
              <span className={cn('hidden truncate text-[13px] md:block', item.leader ? 'text-[#d4d4d4]' : 'text-[#8e8e93]')}>{item.leader ? personName(item.leader) : 'unbekannt'}</span>
              <span className="hidden truncate text-[12.5px] text-[#98989d] md:block">{item.address || '—'}</span>
              <span className="hidden text-[12.5px] md:block"><OpenCount open={item.openInvestigations ?? 0} total={item._count?.investigations ?? 0} /></span>
              <span className="hidden text-[12px] text-[#8e8e93] md:block" title={item.lastActivityAt ? formatDate(item.lastActivityAt) : undefined}>{item.lastActivityAt ? formatRelativeTime(item.lastActivityAt) : '—'}</span>
            </Link>
          </li>)}
        </ul>
      </div>}

    {items.length > 0 && <div className="mt-4 flex items-center justify-between text-xs text-[#8e8e93]">
      <span>{list.data?.total ?? 0} {list.data?.total === 1 ? DOSSIER_LABEL : DOSSIER_LABEL_PLURAL}{pageCount > 1 && ` · Seite ${page} / ${pageCount}`}</span>
      {pageCount > 1 && <div className="flex gap-2">
        <Button variant="ghost" size="sm" disabled={page === 1 || list.loading} onClick={() => setPage(page - 1)}>Zurück</Button>
        <Button variant="ghost" size="sm" disabled={page >= pageCount || list.loading} onClick={() => setPage(page + 1)}>Weiter</Button>
      </div>}
    </div>}
  </>
}

function FamilyThumb({ photoId }: { photoId: string | null }) {
  return photoId
    ? <Image unoptimized src={photoUrl(photoId)} alt="" width={80} height={80} className="h-10 w-10 rounded-[8px] object-cover" />
    : <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#2c2c2e] text-[#8e8e93]" aria-hidden><Users size={16} /></span>
}

function OpenCount({ open, total }: { open: number; total: number }) {
  return <>
    <span className={open > 0 ? 'font-medium text-[#86efac]' : 'text-[#8e8e93]'}>{open > 0 ? `${open} offen` : 'keine offen'}</span>
    <span className="text-[#8e8e93]"> / {total}</span>
  </>
}

/* ── Einzelne Familienakte: Akten im Mittelpunkt ───────────────────── */

function DossierDetail({ id, dossier, error, manage, onEdit, onChanged }: {
  id: string
  dossier: Dossier | null
  error: string | null
  manage: boolean
  onEdit: () => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const router = useRouter()
  const [quick, setQuick] = useState<RegisterField | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const { execute, loading: saving } = useApi()

  const investigations = dossier?.investigations ?? []
  const openCount = investigations.filter(item => isOpen(item.status)).length
  const lastActivity = [dossier?.updatedAt, ...investigations.map(item => item.updatedAt)].filter((value): value is string => Boolean(value)).sort().at(-1)
  const galleryImages = (dossier?.photos ?? []).map(photo => ({ ...photo, url: photoUrl(photo.id) }))
  const members = [...(dossier?.persons ?? [])].sort((a, b) => Number(b.id === dossier?.leaderId) - Number(a.id === dossier?.leaderId))

  const menuItems: ActionMenuItem[] = dossier ? [
    { id: 'edit', label: 'Akte bearbeiten', icon: Pencil, onSelect: onEdit },
    ...(hasPermission(user, 'investigations:delete')
      ? [{ id: 'delete', label: 'Akte löschen', icon: Trash2, danger: true, onSelect: () => setDeleting(true) }]
      : []),
  ] : []

  return <>
    <PageHeader
      title={dossier?.title ?? 'Akte wird geladen …'}
      breadcrumbs={[{ label: DOSSIER_REGISTER_LABEL, href: '/investigations/dossiers' }, { label: dossier?.title ?? '…' }]}
      action={manage && dossier && <ActionMenu items={menuItems} />}
    />
    <InvestigationsNavigation active="dossiers" />
    {(message || error) && <p role="alert" className="mb-4 text-sm text-[#fca5a5]">{message || error}</p>}

    {dossier && <>
      {/* Stammdaten kompakt oben */}
      <section className="mb-5 rounded-[14px] border border-[#3a3a3c] bg-[#161617] p-5" aria-label="Stammdaten">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {dossier.photoId && <button type="button" onClick={() => setLightboxId(dossier.photoId)} className="shrink-0 overflow-hidden rounded-[10px]" aria-label="Titelbild vergrößern">
            <Image unoptimized src={photoUrl(dossier.photoId)} alt={dossier.title} width={320} height={200} className="h-[110px] w-full object-cover sm:w-[170px]" />
          </button>}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-[#8e8e93]">{DOSSIER_LABEL}{lastActivity ? ` · zuletzt aktiv ${formatRelativeTime(lastActivity)}` : ''}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Fraktionsleiter">
                {dossier.leader
                  ? <Link href={`/investigations/persons?person=${dossier.leader.id}`} className="text-[#c4b5fd] hover:underline">{personName(dossier.leader)}</Link>
                  : <span className="text-[#8e8e93]">Nicht festgelegt</span>}
              </Fact>
              <Fact label="Anwesen">
                {dossier.address
                  ? <span className="inline-flex items-start gap-1.5"><MapPin size={14} className="mt-0.5 shrink-0 text-[#8e8e93]" aria-hidden />{dossier.address}</span>
                  : <span className="text-[#8e8e93]">Nicht bekannt</span>}
              </Fact>
              <Fact label="Einsatzakten"><OpenCount open={openCount} total={investigations.length} /></Fact>
              <Fact label="Mitglieder">{members.length}</Fact>
            </dl>
          </div>
        </div>
        {dossier.description && <p className="mt-4 whitespace-pre-wrap break-words border-t border-[#2c2c2e] pt-4 text-sm leading-relaxed text-[#c7c7cc]">{dossier.description}</p>}
      </section>

      {/* Alle Einsatzakten direkt sichtbar */}
      <SectionCard
        title="Einsatzakten"
        count={investigations.length}
        empty="Noch keine Einsatzakten. Neue Einsätze dieser Familie hier verknüpfen oder beim Anlegen der Einsatzakte die Familie auswählen."
        action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('investigations')}><Plus size={13} />Einsatzakte verknüpfen</Button> : null}
      >
        <ul className="divide-y divide-[#2c2c2e]">
          {investigations.map(item => <li key={item.id}>
            <Link href={`/investigations/${item.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 transition-colors hover:bg-[#1c1c1e] sm:grid-cols-[96px_minmax(0,1fr)_auto_auto_90px] sm:px-1">
              <span className="font-mono text-[12px] text-[#d4af37] sm:order-none">{item.caseNumber}</span>
              <span className="col-span-2 min-w-0 truncate text-[13.5px] text-white sm:col-span-1">{item.title}</span>
              <span className="flex gap-1.5"><PriorityBadge priority={item.priority} /><StatusBadge status={item.status} /></span>
              <span className="hidden text-[12px] text-[#8e8e93] sm:block">{item.createdBy?.displayName ?? ''}</span>
              <span className="text-right text-[12px] text-[#8e8e93]">{formatDate(item.updatedAt)}</span>
            </Link>
          </li>)}
        </ul>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Mitglieder" count={members.length} empty="Noch keine Mitglieder verknüpft."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('persons')}><Plus size={13} />Verknüpfen</Button> : null}>
          <ul className="flex flex-wrap gap-1.5">
            {members.map(person => <li key={person.id}>
              <Link href={`/investigations/persons?person=${person.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-[#38383a] px-3 py-1.5 text-[12.5px] text-[#d4d4d4] hover:border-[#a78bfa]">
                {person.id === dossier.leaderId && <Crown size={12} className="text-[#fbbf24]" aria-label="Fraktionsleiter" />}
                {personName(person)}
                <span className="font-mono text-[11px] text-[#8e8e93]">{person.personNumber}</span>
              </Link>
            </li>)}
          </ul>
        </SectionCard>

        <SectionCard title="Fahrzeuge & Orte" count={(dossier.vehicles?.length ?? 0) + (dossier.mapSpots?.length ?? 0)} empty="Keine Fahrzeuge oder Kartenpunkte verknüpft."
          action={manage ? <Button size="sm" variant="ghost" onClick={() => setQuick('vehicles')}><Plus size={13} />Fahrzeug verknüpfen</Button> : null}>
          <ul className="flex flex-wrap gap-1.5">
            {dossier.vehicles?.map(vehicle => <li key={vehicle.id}>
              <Link href="/investigations/vehicles" className="inline-flex items-center gap-1.5 rounded-full border border-[#38383a] px-3 py-1.5 text-[12.5px] text-[#d4d4d4] hover:border-[#a78bfa]">
                <Car size={12} className="text-[#8e8e93]" aria-hidden />
                {[vehicle.plate, vehicle.model].filter(Boolean).join(' · ') || vehicle.vehicleNumber}
              </Link>
            </li>)}
            {dossier.mapSpots?.map(spot => <li key={spot.id}>
              <Link href={`/map?spot=${encodeURIComponent(spot.id)}`} className="inline-flex items-center gap-1.5 rounded-full border border-[#38383a] px-3 py-1.5 text-[12.5px] text-[#d4d4d4] hover:border-[#a78bfa]">
                <span className="h-2 w-2 rounded-full" style={{ background: mapCategory(spot.category).hex }} aria-hidden />
                {spot.title}
                <span className="text-[#8e8e93]">{mapCategory(spot.category).label}</span>
              </Link>
            </li>)}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Bilder" count={galleryImages.length}
        empty="Noch keine weiteren Bilder. Das Titelbild steht oben in den Stammdaten."
        action={manage ? <Button size="sm" variant="ghost" onClick={onEdit}><ImageIcon size={13} />Bilder verwalten</Button> : null}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {galleryImages.map(photo => <LightboxThumb key={photo.id} image={photo} onOpen={setLightboxId} />)}
        </div>
      </SectionCard>
    </>}

    {quick && dossier && <QuickRelationEditor dossier={dossier} field={quick} onClose={() => setQuick(null)} onSaved={() => { setQuick(null); onChanged() }} />}
    <ImageLightbox
      images={[...(dossier?.photoId ? [{ id: dossier.photoId, title: dossier.title, url: photoUrl(dossier.photoId) }] : []), ...galleryImages]}
      startId={lightboxId}
      onClose={() => setLightboxId(null)}
    />
    <Modal open={deleting} onClose={() => setDeleting(false)} title="Familienakte löschen">
      <p className="mb-4 text-sm text-[#98989d]">„{dossier?.title}“ löschen? Verknüpfte Personen-, Einsatz- und Fahrzeugakten bleiben bestehen.</p>
      <Button variant="danger" loading={saving} onClick={async () => {
        try { await execute(`/api/investigations/dossiers/${id}`, { method: 'DELETE' }); router.push('/investigations/dossiers') }
        catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Löschen fehlgeschlagen'); setDeleting(false) }
      }}>Löschen</Button>
    </Modal>
  </>
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-[11.5px] uppercase tracking-wide text-[#8e8e93]">{label}</dt>
    <dd className="mt-1 text-[13.5px] text-[#e5e5e7]">{children}</dd>
  </div>
}

function RelationPicker({ label, options, value, onChange, single }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (ids: string[]) => void; single?: boolean }) {
  const [search, setSearch] = useState('')
  return <div className="space-y-2">
    <p className="text-sm text-[#98989d]">{label}</p>
    <div className="flex flex-wrap gap-1">{value.map(id => <Button type="button" key={id} variant="secondary" size="sm" onClick={() => onChange(value.filter(v => v !== id))}>{options.find(o => o.id === id)?.label ?? id} ×</Button>)}</div>
    <Input aria-label={`${label} suchen`} placeholder={`${label} suchen …`} value={search} onChange={e => setSearch(e.target.value)} />
    <div className="max-h-36 overflow-y-auto">
      {options.filter(o => !value.includes(o.id) && o.label.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map(option => <button type="button" key={option.id} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[#c7c7cc] hover:bg-[#2c2c2e]" onClick={() => onChange(single ? [option.id] : [...value, option.id])}>+ {option.label}</button>)}
    </div>
  </div>
}

function DossierEditor({ existing, onClose, onSaved }: { existing?: Dossier; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const router = useRouter()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [leaderId, setLeaderId] = useState<string | null>(existing?.leaderId ?? null)
  const [description, setDescription] = useState(existing?.description ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [photoId, setPhotoId] = useState(existing?.photoId ?? null)
  const [photos, setPhotos] = useState<CatalogPhoto[]>(existing?.photos?.map(photo => ({ ...photo, url: photoUrl(photo.id) })) ?? [])
  const [personIds, setPersonIds] = useState(existing?.persons?.map(p => p.id) ?? [])
  const [investigationIds, setInvestigationIds] = useState(existing?.investigations?.map(i => i.id) ?? [])
  const [vehicleIds, setVehicleIds] = useState(existing?.vehicles?.map(v => v.id) ?? [])
  const [mapSpots, setMapSpots] = useState<PickedSpot[]>(existing?.mapSpots ?? [])
  const [failure, setFailure] = useState('')
  const persons = useRegisterOptions('persons')
  const cases = useRegisterOptions('investigations')
  const vehicles = useRegisterOptions('vehicles')
  const optionsLoading = persons.loading || cases.loading || vehicles.loading
  const optionsError = persons.error || cases.error || vehicles.error
  const { execute, loading } = useApi()
  const labelFor = (personId: string | null) => (personId && persons.options.find(option => option.id === personId)?.label) || null

  const save = async () => {
    setFailure('')
    try {
      const saved = await execute(`/api/investigations/dossiers${existing ? `/${existing.id}` : ''}`, {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title,
          leaderId,
          description: description || null,
          address: address || null,
          photoId,
          photoIds: photos.map(photo => photo.id),
          // Der Leiter wird serverseitig ohnehin als Mitglied geführt.
          personIds: leaderId ? [...new Set([...personIds, leaderId])] : personIds,
          investigationIds, vehicleIds,
          mapSpotIds: mapSpots.map(spot => spot.id),
        }),
      })
      onSaved()
      if (!existing && saved && typeof saved === 'object' && 'id' in saved) router.push(href(String(saved.id)))
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen')
    }
  }

  const steps: WizardStep[] = [
    {
      id: 'familie',
      label: 'Familie',
      invalid: title.trim() ? undefined : 'Bitte den Namen der Familie angeben.',
      content: <div className="space-y-4">
        <p className="text-sm leading-6 text-[#98989d]">Eine Familienakte bündelt alles zu einer Familie oder Fraktion. Einzelne Vorfälle kommen als Einsatzakten dazu; Personen und Fahrzeuge werden verknüpft, nicht neu angelegt.</p>
        <Input label="Name der Familie" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="z. B. Familie Moretti" />
        {persons.error && <p role="alert" className="text-sm text-[#fca5a5]">{persons.error}</p>}
        <RelationPicker label="Fraktionsleiter" single options={persons.options} value={leaderId ? [leaderId] : []} onChange={ids => setLeaderId(ids[0] ?? null)} />
        <Input label="Anwesen" value={address} onChange={e => setAddress(e.target.value)} maxLength={300} placeholder="z. B. Vinewood Hills 12" />
        <PhotoField value={photoId ? photoUrl(photoId) : null} onChange={photo => setPhotoId(photo?.id ?? null)} />
      </div>,
    },
    {
      id: 'beschreibung',
      label: 'Beschreibung & Bilder',
      optional: true,
      content: <div className="space-y-4">
        <Textarea label="Informationen und Notizen" value={description} onChange={e => setDescription(e.target.value)} maxLength={30000} rows={6} placeholder="Hintergründe, Geschäfte, Verbündete, Beobachtungen …" />
        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-[#98989d]">Weitere Bilder</p>
          <PhotoPicker value={photos} onChange={setPhotos} />
        </div>
      </div>,
    },
    {
      id: 'karte',
      label: 'Kartenpunkte',
      optional: true,
      content: <div className="space-y-3">
        <p className="text-[12.5px] text-[#98989d]">Routen, Sammler und Orte, die zu dieser Familie gehören.</p>
        <SpotPickerField initialLayer="estates" value={mapSpots} onChange={setMapSpots} canCreate={hasPermission(user, 'map:manage')} />
      </div>,
    },
    {
      id: 'verknuepfungen',
      label: 'Mitglieder & Akten',
      optional: true,
      content: <div className="space-y-4">
        {optionsError && <p role="alert" className="text-sm text-[#fca5a5]">{optionsError}</p>}
        <RelationPicker label="Mitglieder" options={persons.options} value={personIds} onChange={ids => {
          setPersonIds(ids)
          if (leaderId && !ids.includes(leaderId)) setLeaderId(null)
        }} />
        <RelationPicker label="Einsatzakten" options={cases.options} value={investigationIds} onChange={setInvestigationIds} />
        <RelationPicker label="Fahrzeugakten" options={vehicles.options} value={vehicleIds} onChange={setVehicleIds} />
      </div>,
    },
    {
      id: 'pruefen',
      label: 'Prüfen',
      content: <dl className="grid gap-2.5 text-[12.5px]">
        {([
          ['Familie', title || '—'],
          ['Fraktionsleiter', labelFor(leaderId) ?? '—'],
          ['Anwesen', address || '—'],
          ['Kartenpunkte', mapSpots.length ? mapSpots.map(spot => spot.title).join(', ') : 'Keine'],
          ['Mitglieder', String(new Set([...personIds, ...(leaderId ? [leaderId] : [])]).size)],
          ['Einsatzakten', String(investigationIds.length)],
          ['Fahrzeuge', String(vehicleIds.length)],
        ] as [string, string][]).map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1c1c1e] pb-2">
          <dt className="w-36 shrink-0 text-[#8e8e93]">{label}</dt>
          <dd className="min-w-0 text-[#d4d4d4]">{value}</dd>
        </div>)}
      </dl>,
    },
  ]

  return <Modal open onClose={loading ? () => {} : onClose} title={existing ? 'Familienakte bearbeiten' : 'Familienakte anlegen'} size="xl">
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

/** Auswahl einer bestehenden Familienakte. */
function DossierPicker({ title, excludeIds, busy, failure, onPick, onClose }: { title: string; excludeIds: string[]; busy: boolean; failure?: string; onPick: (dossier: Dossier) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)
  const list = useFetch<List>(`/api/investigations/dossiers?search=${encodeURIComponent(debounced)}&sort=name`)
  const options = (list.data?.items ?? []).filter(item => !excludeIds.includes(item.id))
  return <Modal open onClose={busy ? () => {} : onClose} title={title} size="lg">
    <div className="space-y-3">
      <Input aria-label="Familienakte suchen" placeholder="Familie suchen …" value={search} onChange={e => setSearch(e.target.value)} />
      {(failure || list.error) && <p role="alert" className="text-sm text-[#fca5a5]">{failure || list.error}</p>}
      {list.loading ? <ListSkeleton compact /> : !options.length ? <p className="text-sm text-[#8e8e93]">Keine passende Familienakte gefunden.</p> : <ul className="max-h-72 space-y-1 overflow-y-auto">{options.map(item => <li key={item.id}><button type="button" disabled={busy} className="block w-full rounded px-2 py-2 text-left text-sm text-[#c4b5fd] hover:bg-[#2c2c2e] disabled:opacity-50" onClick={() => onPick(item)}>{item.title}{item.leader ? <span className="text-[#8e8e93]"> · {personName(item.leader)}</span> : null}</button></li>)}</ul>}
      <div className="flex justify-end border-t border-[#2c2c2e] pt-3"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Abbrechen</Button></div>
    </div>
  </Modal>
}

/** Familienakten, in denen dieser Datensatz steckt – inklusive Hinzufügen/Entfernen.
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
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">{heading}</h3>{manage && <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}><Plus size={13} />Zu Familienakte hinzufügen</Button>}</div>
    {(error || failure) && <p role="alert" className="text-xs text-[#fca5a5]">{failure || error}</p>}
    {linked.length ? <ul className="space-y-1">{linked.map(item => <li key={item.id} className="flex items-center gap-2">
      <Link className="text-sm text-[#c4b5fd] hover:underline" href={href(item.id)}>{item.title}</Link>
      {relation === 'person' && item.leader?.id === recordId && <span className="inline-flex items-center gap-1 text-[11.5px] text-[#fbbf24]"><Crown size={11} aria-hidden />Leiter</span>}
      {manage && <button type="button" disabled={loading} className="text-xs text-[#8e8e93] hover:text-[#fca5a5] disabled:opacity-50" aria-label={`${item.title} entfernen`} onClick={() => setMembership(item.id, false)}>Entfernen</button>}
    </li>)}</ul> : <p className="text-xs text-[#8e8e93]">Keiner Familienakte zugeordnet.</p>}
    <Link className="inline-block text-xs text-[#98989d] hover:text-white" href="/investigations/dossiers">{DOSSIER_REGISTER_LABEL} öffnen →</Link>
    {picking && <DossierPicker title="Zu welcher Familienakte hinzufügen?" excludeIds={linked.map(item => item.id)} busy={loading} failure={failure} onPick={dossier => setMembership(dossier.id, true)} onClose={() => setPicking(false)} />}
  </section>
}

/**
 * Beschreibt eine Registerrubrik einmal zentral: woher die Auswahl kommt, wie
 * ein Eintrag heißt und unter welchem Feld die API sie erwartet. Editor und
 * Schnellzuordnung greifen beide darauf zu.
 */
const REGISTER_FIELDS: Record<RegisterField, { label: string; endpoint: string; payloadKey: string }> = {
  persons: { label: 'Mitglieder', endpoint: '/api/persons', payloadKey: 'personIds' },
  investigations: { label: 'Einsatzakten', endpoint: '/api/investigations', payloadKey: 'investigationIds' },
  vehicles: { label: 'Fahrzeugakten', endpoint: '/api/vehicles', payloadKey: 'vehicleIds' },
}

type RegisterRow = { id: string; firstName?: string; lastName?: string; personNumber?: string; caseNumber?: string; title?: string; vehicleNumber?: string; plate?: string | null; model?: string | null; recordedAt?: string | null }

function registerLabel(field: RegisterField, row: RegisterRow): string {
  if (field === 'persons') return `${row.firstName} ${row.lastName} (${row.personNumber})`
  if (field === 'investigations') return `${row.caseNumber} · ${row.title}`
  return `${[row.plate, row.model].filter(Boolean).join(' · ') || row.vehicleNumber} (${row.vehicleNumber})`
}

function currentIds(dossier: Dossier, field: RegisterField): string[] {
  const entries = field === 'persons' ? dossier.persons : field === 'investigations' ? dossier.investigations : dossier.vehicles
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
      {optionsError && <p role="alert" className="text-sm text-[#fca5a5]">{optionsError}</p>}
      <RelationPicker label={REGISTER_FIELDS[field].label} options={options} value={ids} onChange={setIds} />
      {failure && <p role="alert" className="text-sm text-[#fca5a5]">{failure}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={loading} onClick={onClose}>Abbrechen</Button><Button type="submit" loading={loading} disabled={optionsLoading || !!optionsError}>Speichern</Button></div>
    </form>
  </Modal>
}

export function PersonDossiers({ personId }: { personId: string }) {
  return <LinkedDossiers relation="person" recordId={personId} heading={DOSSIER_LABEL_PLURAL} />
}

export function InvestigationDossiers({ investigationId }: { investigationId: string }) {
  return <LinkedDossiers relation="investigation" recordId={investigationId} heading={DOSSIER_LABEL_PLURAL} />
}
