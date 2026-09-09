'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Car, Plus } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar, SearchInput } from '@/components/ui/filter-bar'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { PriorityBadge, StatusBadge } from '@/components/investigations/investigation-badges'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { vehicleLabel } from '@/components/investigations/investigation-vehicles'
import { PhotoField } from '@/components/investigations/photo-catalog'
import { useApi } from '@/hooks/use-api'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'

const catalogPhotoUrl = (id: string) => `/api/investigations/photos/${id}/image`
import type {
  InvestigationListItem,
  Person,
  Vehicle,
} from '@/components/investigations/types'

type VehicleDetail = Vehicle & {
  investigations: {
    id: string
    note: string | null
    investigation: Pick<
      InvestigationListItem,
      'id' | 'caseNumber' | 'title' | 'status' | 'priority' | 'classified' | 'updatedAt'
    >
  }[]
}

type VehicleForm = {
  photoId: string | null
  plate: string
  model: string
  color: string
  ownerPersonId: string
  notes: string
  stolen: boolean
  wanted: boolean
}

function emptyForm(): VehicleForm {
  return { photoId: null, plate: '', model: '', color: '', ownerPersonId: '', notes: '', stolen: false, wanted: false }
}

export function VehicleRegister() {
  const { user } = useAuth()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')

  const [search, setSearch] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<VehicleForm>(emptyForm)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (flaggedOnly) params.set('flagged', 'true')
    const suffix = params.toString()
    return `/api/vehicles${suffix ? `?${suffix}` : ''}`
  }, [search, flaggedOnly])

  const { data, loading, refetch } = useFetch<Vehicle[]>(canView ? query : null)
  const { data: persons } = useFetch<Person[]>(createOpen && canManage ? '/api/persons' : null)
  const { data: detail, loading: detailLoading } = useFetch<VehicleDetail>(
    selectedId ? `/api/vehicles/${selectedId}` : null,
  )
  const { mutate, saving } = useInvestigationMutation(refetch)
  const { execute } = useApi()
  const { toastSuccess, toastError } = useInvestigationToast()

  if (!canView) return <UnauthorizedContent />

  const handleCreate = async () => {
    const ok = await mutate('/api/vehicles', {
      body: { ...form, ownerPersonId: form.ownerPersonId || null },
      successTitle: 'Fahrzeug erfasst',
      errorTitle: 'Anlegen fehlgeschlagen',
    })
    if (ok) {
      setForm(emptyForm())
      setCreateOpen(false)
    }
  }

  const vehicles = data ?? []

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <InvestigationsNavigation active="vehicles" />

      <PageHeader
        eyebrow="Ermittlungen"
        title="Fahrzeugregister"
        description="Fallübergreifende Fahrzeugakten mit Halter, Fahndungsstatus und beteiligten Ermittlungen."
        action={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Neues Fahrzeug
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Fahrzeug suchen"
          placeholder="Kennzeichen, Modell, Halter oder FZG-Nummer"
        />
        <Checkbox
          checked={flaggedOnly}
          onCheckedChange={setFlaggedOnly}
          label="Nur Fahndung / gestohlen"
        />
      </FilterBar>

      {loading ? (
        <PageLoader />
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          title={search || flaggedOnly ? 'Kein Fahrzeug passt zu diesem Filter.' : 'Noch keine Fahrzeuge im Register.'}
          hint={
            search || flaggedOnly
              ? 'Andere Schreibweise probieren oder den Filter zurücksetzen.'
              : 'Fahrzeugakten lassen sich an Einsatzakten und Dauerakten hängen.'
          }
          action={
            search || flaggedOnly ? (
              <Button variant="outline" onClick={() => { setSearch(''); setFlaggedOnly(false) }}>
                Filter zurücksetzen
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {vehicles.map((vehicle) => (
            <button
              key={vehicle.id}
              type="button"
              onClick={() => setSelectedId(vehicle.id)}
              className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5 text-left transition-colors hover:border-[#404040] hover:bg-[#181818]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px] text-[#d4af37]">{vehicle.vehicleNumber}</span>
                {vehicle.stolen && <Badge variant="danger">Gestohlen</Badge>}
                {vehicle.wanted && <Badge variant="warning">Fahndung</Badge>}
              </div>
              <p className="mt-1.5 text-[14px] font-semibold text-white">{vehicleLabel(vehicle)}</p>
              <p className="mt-1 text-[11.5px] text-[#6a6a6a]">
                {vehicle.color ? `${vehicle.color} · ` : ''}
                {vehicle.ownerPerson
                  ? `Halter: ${vehicle.ownerPerson.firstName} ${vehicle.ownerPerson.lastName}`
                  : 'Halter unbekannt'}
                {vehicle._count ? ` · ${vehicle._count.investigations} Ermittlung(en)` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Fahrzeugakte */}
      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail ? vehicleLabel(detail) : 'Fahrzeugakte'}
        description={detail?.vehicleNumber}
        size="lg"
      >
        {detailLoading || !detail ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {detail.stolen && <Badge variant="danger">Als gestohlen gemeldet</Badge>}
              {detail.wanted && <Badge variant="warning">Zur Fahndung ausgeschrieben</Badge>}
            </div>

            <PhotoField
              value={detail.photoId ? catalogPhotoUrl(detail.photoId) : null}
              readOnly={!canManage}
              onChange={async (photo) => {
                try {
                  await execute(`/api/vehicles/${detail.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ photoId: photo?.id ?? null }),
                  })
                  await refetch()
                  toastSuccess('Foto gespeichert', 'Die Fahrzeugakte wurde aktualisiert.')
                } catch (cause) {
                  toastError('Foto nicht gespeichert', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
                }
              }}
            />

            <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              {detail.plate && (
                <div>
                  <dt className="text-[#6a6a6a]">Kennzeichen</dt>
                  <dd className="font-mono text-[#e4e4e4]">{detail.plate}</dd>
                </div>
              )}
              {detail.model && (
                <div>
                  <dt className="text-[#6a6a6a]">Modell</dt>
                  <dd className="text-[#e4e4e4]">{detail.model}</dd>
                </div>
              )}
              {detail.color && (
                <div>
                  <dt className="text-[#6a6a6a]">Farbe</dt>
                  <dd className="text-[#e4e4e4]">{detail.color}</dd>
                </div>
              )}
              <div>
                <dt className="text-[#6a6a6a]">Halter</dt>
                <dd className="text-[#e4e4e4]">
                  {detail.ownerPerson ? (
                    <Link
                      href={`/investigations/persons?person=${detail.ownerPerson.id}`}
                      className="text-[#c4b5fd] hover:underline"
                    >
                      {detail.ownerPerson.firstName} {detail.ownerPerson.lastName}
                    </Link>
                  ) : (
                    'Unbekannt'
                  )}
                </dd>
              </div>
            </dl>

            {detail.notes && (
              <div>
                <p className="mb-1 text-[12px] font-medium text-[#a6a6a6]">Notizen</p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
                  {detail.notes}
                </p>
              </div>
            )}

            <div>
              <p className="mb-2 text-[12px] font-medium text-[#a6a6a6]">
                Ermittlungen ({detail.investigations.length})
              </p>
              {detail.investigations.length === 0 ? (
                <p className="text-[12.5px] text-[#6a6a6a]">Keiner Akte zugeordnet.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.investigations.map((link) => (
                    <li key={link.id}>
                      <Link
                        href={`/investigations/${link.investigation.id}`}
                        className="block rounded-[9px] border border-[#232323] bg-[#111111] p-2.5 transition-colors hover:border-[#404040]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11.5px] text-[#d4af37]">
                            {link.investigation.caseNumber}
                          </span>
                          <StatusBadge status={link.investigation.status} />
                          <PriorityBadge priority={link.investigation.priority} />
                        </div>
                        <p className="mt-1 text-[13px] text-white">{link.investigation.title}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Fahrzeug anlegen */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neues Fahrzeug"
        description="Kennzeichen oder Modell genügt; die Registernummer wird automatisch vergeben."
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Kennzeichen"
              value={form.plate}
              onChange={(event) => setForm((prev) => ({ ...prev, plate: event.target.value }))}
              placeholder="z. B. 46EEK572"
            />
            <Input
              label="Modell"
              value={form.model}
              onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="z. B. Sultan RS"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Farbe"
              value={form.color}
              onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
            />
            <Select
              label="Halter"
              options={[
                { value: '', label: 'Unbekannt' },
                ...(persons ?? []).map((person) => ({
                  value: person.id,
                  label: `${person.lastName}, ${person.firstName} (${person.personNumber})`,
                })),
              ]}
              value={form.ownerPersonId}
              onValueChange={(value) => setForm((prev) => ({ ...prev, ownerPersonId: value }))}
            />
          </div>
          <PhotoField
            value={form.photoId ? catalogPhotoUrl(form.photoId) : null}
            onChange={(photo) => setForm((prev) => ({ ...prev, photoId: photo?.id ?? null }))}
          />
          <Textarea
            label="Notizen"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            rows={3}
          />
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={form.stolen}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, stolen: checked }))}
              label="Als gestohlen gemeldet"
            />
            <Checkbox
              checked={form.wanted}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, wanted: checked }))}
              label="Zur Fahndung ausgeschrieben"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreate} loading={saving} disabled={!form.plate && !form.model}>
              Fahrzeug anlegen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
