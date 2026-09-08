'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Car, Plus, Search, UserSearch } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { formatDate } from '@/lib/utils'
import { PriorityBadge, StatusBadge } from '@/components/investigations/investigation-badges'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { PersonLinks } from '@/components/investigations/person-links'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type {
  InvestigationListItem,
  Person,
  PersonLink,
  Vehicle,
} from '@/components/investigations/types'

type PersonForm = {
  firstName: string
  lastName: string
  alias: string
  identifier: string
  dateOfBirth: string
  phone: string
  photoUrl: string
  notes: string
  wanted: boolean
  dangerous: boolean
}

function emptyForm(): PersonForm {
  return {
    firstName: '',
    lastName: '',
    alias: '',
    identifier: '',
    dateOfBirth: '',
    phone: '',
    photoUrl: '',
    notes: '',
    wanted: false,
    dangerous: false,
  }
}

type PersonDetail = Person & {
  vehiclesOwned: Vehicle[]
  linksFrom: (PersonLink & { toPerson: Person })[]
  linksTo: (PersonLink & { fromPerson: Person })[]
  investigations: {
    id: string
    role: string
    note: string | null
    investigation: Pick<
      InvestigationListItem,
      'id' | 'caseNumber' | 'title' | 'status' | 'priority' | 'classified' | 'updatedAt'
    >
  }[]
}

export function PersonRegister() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading: saving } = useApi()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')

  const [search, setSearch] = useState('')
  const [wantedOnly, setWantedOnly] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<PersonForm>(emptyForm)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Erlaubt den Direktsprung aus einer Akte auf eine bestimmte Personenakte.
  useEffect(() => {
    const requested = searchParams.get('person')
    if (requested) setSelectedId(requested)
  }, [searchParams])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (wantedOnly) params.set('wanted', 'true')
    const suffix = params.toString()
    return `/api/persons${suffix ? `?${suffix}` : ''}`
  }, [search, wantedOnly])

  const { data, loading, refetch } = useFetch<Person[]>(canView ? query : null)
  const {
    data: detail,
    loading: detailLoading,
    refetch: refetchDetail,
  } = useFetch<PersonDetail>(selectedId ? `/api/persons/${selectedId}` : null)

  if (!canView) return <UnauthorizedContent />

  const handleCreate = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toastError('Name fehlt', 'Vor- und Nachname sind erforderlich.')
      return
    }

    try {
      await execute('/api/persons', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
        }),
      })
      toastSuccess('Person angelegt', 'Die Personenakte wurde erstellt.')
      setCreateOpen(false)
      setForm(emptyForm())
      await refetch()
    } catch (cause) {
      toastError('Anlegen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const persons = data ?? []

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <InvestigationsNavigation active="persons" />

      <PageHeader
        eyebrow="Ermittlungen"
        title="Personenregister"
        description="Fallübergreifende Personenakten. Eine Person kann in mehreren Ermittlungen auftauchen."
        action={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Neue Person
            </Button>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#808080]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, Alias, Kennung oder PER-Nummer"
            className="pl-9"
          />
        </div>
        <Checkbox checked={wantedOnly} onCheckedChange={setWantedOnly} label="Nur zur Fahndung" />
      </div>

      {loading ? (
        <PageLoader />
      ) : persons.length === 0 ? (
        <Card className="py-14 text-center">
          <UserSearch className="mx-auto h-8 w-8 text-[#4a4a4a]" />
          <p className="mt-3 text-[13.5px] text-[#a6a6a6]">Keine Personen gefunden.</p>
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {persons.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setSelectedId(person.id)}
              className="rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-3.5 text-left transition-colors hover:border-[#404040] hover:bg-[#181818]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px] text-[#d4af37]">{person.personNumber}</span>
                {person.wanted && <Badge variant="danger">Fahndung</Badge>}
                {person.dangerous && (
                  <Badge variant="warning" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Gefährlich
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-[14px] font-semibold text-white">
                {person.firstName} {person.lastName}
              </p>
              {person.alias && <p className="text-[12px] text-[#a6a6a6]">alias &bdquo;{person.alias}&ldquo;</p>}
              <p className="mt-1 text-[11.5px] text-[#6a6a6a]">
                {person._count ? `${person._count.investigations} Ermittlung(en)` : ''}
                {person.identifier ? ` · Kennung ${person.identifier}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Personenakte */}
      <Modal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={detail ? `${detail.firstName} ${detail.lastName}` : 'Personenakte'}
        description={detail?.personNumber}
        size="xl"
      >
        {detailLoading || !detail ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {detail.wanted && <Badge variant="danger">Zur Fahndung ausgeschrieben</Badge>}
              {detail.dangerous && <Badge variant="warning">Als gefährlich eingestuft</Badge>}
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              {detail.alias && (
                <div>
                  <dt className="text-[#6a6a6a]">Alias</dt>
                  <dd className="text-[#e4e4e4]">{detail.alias}</dd>
                </div>
              )}
              {detail.identifier && (
                <div>
                  <dt className="text-[#6a6a6a]">Kennung</dt>
                  <dd className="text-[#e4e4e4]">{detail.identifier}</dd>
                </div>
              )}
              {detail.dateOfBirth && (
                <div>
                  <dt className="text-[#6a6a6a]">Geburtsdatum</dt>
                  <dd className="text-[#e4e4e4]">{formatDate(detail.dateOfBirth)}</dd>
                </div>
              )}
              {detail.phone && (
                <div>
                  <dt className="text-[#6a6a6a]">Telefon</dt>
                  <dd className="text-[#e4e4e4]">{detail.phone}</dd>
                </div>
              )}
            </dl>

            {detail.notes && (
              <div>
                <p className="mb-1 text-[12px] font-medium text-[#a6a6a6]">Notizen</p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
                  {detail.notes}
                </p>
              </div>
            )}

            <PersonLinks
              personId={detail.id}
              linksFrom={detail.linksFrom}
              linksTo={detail.linksTo}
              persons={persons}
              canManage={canManage}
              onChanged={refetchDetail}
            />

            {detail.vehiclesOwned.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-medium text-[#a6a6a6]">
                  Fahrzeuge ({detail.vehiclesOwned.length})
                </p>
                <ul className="space-y-1.5">
                  {detail.vehiclesOwned.map((vehicle) => (
                    <li
                      key={vehicle.id}
                      className="flex flex-wrap items-center gap-2 rounded-[9px] border border-[#232323] bg-[#111111] px-2.5 py-2 text-[12.5px] text-white"
                    >
                      <Car className="h-3.5 w-3.5 shrink-0 text-[#6a6a6a]" />
                      {[vehicle.plate, vehicle.model].filter(Boolean).join(' · ') || vehicle.vehicleNumber}
                      <span className="font-mono text-[11px] text-[#6a6a6a]">{vehicle.vehicleNumber}</span>
                      {vehicle.stolen && <Badge variant="danger">Gestohlen</Badge>}
                      {vehicle.wanted && <Badge variant="warning">Fahndung</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-[12px] font-medium text-[#a6a6a6]">
                Ermittlungen ({detail.investigations.length})
              </p>
              {detail.investigations.length === 0 ? (
                <p className="text-[12.5px] text-[#6a6a6a]">Diese Person ist keiner Akte zugeordnet.</p>
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

      {/* Person anlegen */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neue Person"
        description="Die Personenaktennummer wird automatisch vergeben."
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Vorname"
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
            />
            <Input
              label="Nachname"
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Alias"
              value={form.alias}
              onChange={(event) => setForm((prev) => ({ ...prev, alias: event.target.value }))}
            />
            <Input
              label="Kennung / Ausweisnummer"
              value={form.identifier}
              onChange={(event) => setForm((prev) => ({ ...prev, identifier: event.target.value }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Geburtsdatum"
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => setForm((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
            />
            <Input
              label="Telefon"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </div>
          <Input
            label="Foto-URL"
            value={form.photoUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, photoUrl: event.target.value }))}
            placeholder="https://…"
          />
          <Textarea
            label="Notizen"
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            rows={4}
          />
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={form.wanted}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, wanted: checked }))}
              label="Zur Fahndung ausgeschrieben"
            />
            <Checkbox
              checked={form.dangerous}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, dangerous: checked }))}
              label="Als gefährlich eingestuft"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreate} loading={saving}>
              Person anlegen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
