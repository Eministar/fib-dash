'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Car, Pencil, Plus, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar, SearchInput } from '@/components/ui/filter-bar'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { PriorityBadge, StatusBadge } from '@/components/investigations/investigation-badges'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { vehicleLabel } from '@/components/investigations/investigation-vehicles'
import {
  VehicleFormFields,
  emptyVehicleForm,
  vehicleFormFrom,
  vehicleFormIsComplete,
  type VehicleForm,
} from '@/components/investigations/vehicle-form'

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

export function VehicleRegister() {
  const { user } = useAuth()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')
  const canDelete = hasPermission(user, 'investigations:delete')

  const [search, setSearch] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<VehicleForm>(emptyVehicleForm)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Gefüllt, solange die geöffnete Fahrzeugakte bearbeitet wird. */
  const [edit, setEdit] = useState<VehicleForm | null>(null)
  const [deleting, setDeleting] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (flaggedOnly) params.set('flagged', 'true')
    const suffix = params.toString()
    return `/api/vehicles${suffix ? `?${suffix}` : ''}`
  }, [search, flaggedOnly])

  const { data, loading, refetch } = useFetch<Vehicle[]>(canView ? query : null)
  // Das Halterfeld braucht die Personenliste in beiden Modalen.
  const { data: persons } = useFetch<Person[]>((createOpen || edit) && canManage ? '/api/persons' : null)
  const {
    data: detail,
    loading: detailLoading,
    refetch: refetchDetail,
  } = useFetch<VehicleDetail>(selectedId ? `/api/vehicles/${selectedId}` : null)
  const { mutate, saving } = useInvestigationMutation(refetch)

  if (!canView) return <UnauthorizedContent />

  const closeDetail = () => {
    setSelectedId(null)
    setEdit(null)
    setDeleting(false)
  }

  const handleCreate = async () => {
    const ok = await mutate('/api/vehicles', {
      body: { ...form, ownerPersonId: form.ownerPersonId || null },
      successTitle: 'Fahrzeug erfasst',
      errorTitle: 'Anlegen fehlgeschlagen',
    })
    if (ok) {
      setForm(emptyVehicleForm())
      setCreateOpen(false)
    }
  }

  const handleUpdate = async () => {
    if (!detail || !edit) return
    const ok = await mutate(`/api/vehicles/${detail.id}`, {
      method: 'PATCH',
      body: { ...edit, ownerPersonId: edit.ownerPersonId || null },
      successTitle: 'Fahrzeugakte gespeichert',
      errorTitle: 'Speichern fehlgeschlagen',
    })
    if (ok) {
      setEdit(null)
      await refetchDetail()
    }
  }

  const handleDelete = async () => {
    if (!detail) return
    const ok = await mutate(`/api/vehicles/${detail.id}`, {
      method: 'DELETE',
      successTitle: 'Fahrzeug gelöscht',
      errorTitle: 'Löschen fehlgeschlagen',
    })
    if (ok) closeDetail()
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
        onClose={saving ? () => {} : closeDetail}
        title={detail ? vehicleLabel(detail) : 'Fahrzeugakte'}
        description={detail?.vehicleNumber}
        size="lg"
      >
        {detailLoading || !detail ? (
          <PageLoader />
        ) : edit ? (
          <div className="space-y-4">
            <VehicleFormFields form={edit} persons={persons ?? []} onChange={setEdit} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" disabled={saving} onClick={() => setEdit(null)}>
                Abbrechen
              </Button>
              <Button onClick={handleUpdate} loading={saving} disabled={!vehicleFormIsComplete(edit)}>
                Änderungen speichern
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {detail.stolen && <Badge variant="danger">Als gestohlen gemeldet</Badge>}
                {detail.wanted && <Badge variant="warning">Zur Fahndung ausgeschrieben</Badge>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEdit(vehicleFormFrom(detail))}>
                    <Pencil className="h-3.5 w-3.5" />
                    Akte bearbeiten
                  </Button>
                  {canDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Löschen
                    </Button>
                  )}
                </div>
              )}
            </div>

            {detail.photoId && (
              <Image
                unoptimized
                src={catalogPhotoUrl(detail.photoId)}
                alt={vehicleLabel(detail)}
                width={1000}
                height={560}
                className="max-h-72 w-full rounded-lg object-contain"
              />
            )}

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

      {/* Fahrzeug löschen */}
      <Modal
        open={deleting}
        onClose={saving ? () => {} : () => setDeleting(false)}
        title="Fahrzeugakte löschen"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[#c4c4c4]">
            „{detail ? vehicleLabel(detail) : 'Fahrzeug'}“ endgültig löschen? Fahrzeuge, die noch an einer
            Akte hängen, lassen sich nicht löschen – dort zuerst die Verknüpfung lösen.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setDeleting(false)}>
              Abbrechen
            </Button>
            <Button variant="danger" loading={saving} onClick={handleDelete}>
              Löschen
            </Button>
          </div>
        </div>
      </Modal>

      {/* Fahrzeug anlegen */}
      <Modal
        open={createOpen}
        onClose={saving ? () => {} : () => setCreateOpen(false)}
        title="Neues Fahrzeug"
        description="Kennzeichen oder Modell genügt; die Registernummer wird automatisch vergeben."
        size="lg"
      >
        <div className="space-y-4">
          <VehicleFormFields form={form} persons={persons ?? []} onChange={setForm} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" disabled={saving} onClick={() => setCreateOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreate} loading={saving} disabled={!vehicleFormIsComplete(form)}>
              Fahrzeug anlegen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
