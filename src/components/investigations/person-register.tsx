'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Car, Pencil, Plus, Trash2, UserSearch } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar, SearchInput } from '@/components/ui/filter-bar'
import { PersonLinks } from '@/components/investigations/person-links'
import { PhotoField } from '@/components/investigations/photo-catalog'
import { PersonDossiers } from '@/components/investigations/dossiers-workspace'
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

function formFromPerson(person: PersonDetail): PersonForm {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    alias: person.alias ?? '',
    identifier: person.identifier ?? '',
    // Das native Date-Input akzeptiert ausschließlich `YYYY-MM-DD`.
    dateOfBirth: person.dateOfBirth ? new Date(person.dateOfBirth).toISOString().slice(0, 10) : '',
    phone: person.phone ?? '',
    photoUrl: person.photoUrl ?? '',
    notes: person.notes ?? '',
    wanted: person.wanted,
    dangerous: person.dangerous,
  }
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
  const canDelete = hasPermission(user, 'investigations:delete')

  const [search, setSearch] = useState('')
  const [wantedOnly, setWantedOnly] = useState(false)
  // `null` = Editor geschlossen, sonst der Modus. Anlegen und Bearbeiten teilen
  // sich dasselbe Formular, damit die Felder nicht auseinanderlaufen.
  const [editor, setEditor] = useState<'create' | 'edit' | null>(null)
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

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toastError('Name fehlt', 'Vor- und Nachname sind erforderlich.')
      return
    }

    const editing = editor === 'edit' && detail
    try {
      await execute(editing ? `/api/persons/${detail.id}` : '/api/persons', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          alias: form.alias.trim() || null,
          identifier: form.identifier.trim() || null,
          phone: form.phone.trim() || null,
          photoUrl: form.photoUrl.trim() || null,
          notes: form.notes.trim() || null,
          dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
        }),
      })
      toastSuccess(
        editing ? 'Personenakte gespeichert' : 'Person angelegt',
        editing ? 'Die Änderungen wurden übernommen.' : 'Die Personenakte wurde erstellt.',
      )
      setEditor(null)
      setForm(emptyForm())
      await refetch()
      if (editing) await refetchDetail()
    } catch (cause) {
      toastError(
        editing ? 'Speichern fehlgeschlagen' : 'Anlegen fehlgeschlagen',
        cause instanceof Error ? cause.message : 'Unbekannter Fehler',
      )
    }
  }

  const handleDelete = async () => {
    if (!detail) return
    if (
      !window.confirm(
        `Personenakte ${detail.personNumber} (${detail.firstName} ${detail.lastName}) endgültig löschen?`,
      )
    ) {
      return
    }

    try {
      await execute(`/api/persons/${detail.id}`, { method: 'DELETE' })
      toastSuccess('Personenakte gelöscht', `${detail.personNumber} wurde entfernt.`)
      setSelectedId(null)
      await refetch()
    } catch (cause) {
      // Die API blockt das Löschen, solange die Person noch an Akten hängt –
      // diese Begründung ist für den Benutzer die eigentliche Information.
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
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
            <Button
              onClick={() => {
                setForm(emptyForm())
                setEditor('create')
              }}
            >
              <Plus className="h-4 w-4" />
              Neue Person
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Person suchen"
          placeholder="Name, Alias, Kennung oder PER-Nummer"
        />
        <Checkbox checked={wantedOnly} onCheckedChange={setWantedOnly} label="Nur zur Fahndung" />
      </FilterBar>

      {loading ? (
        <PageLoader />
      ) : persons.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={search || wantedOnly ? 'Keine Person passt zu diesem Filter.' : 'Noch keine Personen im Register.'}
          hint={
            search || wantedOnly
              ? 'Andere Schreibweise probieren oder den Filter zurücksetzen.'
              : 'Personen aus diesem Register lassen sich in beliebig vielen Einsatzakten verknüpfen.'
          }
          action={
            search || wantedOnly ? (
              <Button variant="outline" onClick={() => { setSearch(''); setWantedOnly(false) }}>
                Filter zurücksetzen
              </Button>
            ) : canManage ? (
              <Button onClick={() => { setForm(emptyForm()); setEditor('create') }}>
                <Plus className="h-4 w-4" />
                Neue Person
              </Button>
            ) : null
          }
        />
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
        // Solange der Editor offen ist, tritt die Akte zurück – zwei
        // gestapelte Dialoge würden sich um den Fokus streiten.
        open={Boolean(selectedId) && editor !== 'edit'}
        onClose={() => setSelectedId(null)}
        title={detail ? `${detail.firstName} ${detail.lastName}` : 'Personenakte'}
        description={detail?.personNumber}
        size="xl"
      >
        {detailLoading || !detail ? (
          <PageLoader />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {detail.wanted && <Badge variant="danger">Zur Fahndung ausgeschrieben</Badge>}
              {detail.dangerous && <Badge variant="warning">Als gefährlich eingestuft</Badge>}
              <div className="ml-auto flex gap-2">
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setForm(formFromPerson(detail))
                      setEditor('edit')
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Bearbeiten
                  </Button>
                )}
                {canDelete && (
                  <Button variant="danger" size="sm" loading={saving} onClick={handleDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Akte löschen
                  </Button>
                )}
              </div>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
              <div className="sm:col-span-2"><PhotoField value={detail.photoUrl} readOnly={!canManage} onChange={async photo => {
                try {
                  await execute(`/api/persons/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ photoUrl: photo?.url ?? null }) })
                  await refetchDetail()
                  await refetch()
                  toastSuccess('Foto gespeichert', 'Die Personenakte wurde aktualisiert.')
                } catch (cause) { toastError('Foto nicht gespeichert', cause instanceof Error ? cause.message : 'Unbekannter Fehler') }
              }} /></div>
              <div className="sm:col-span-2"><PersonDossiers personId={detail.id} /></div>
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

      {/* Person anlegen / bearbeiten */}
      <Modal
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor === 'edit' ? 'Personenakte bearbeiten' : 'Neue Person'}
        description={
          editor === 'edit' ? detail?.personNumber : 'Die Personenaktennummer wird automatisch vergeben.'
        }
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
          <PhotoField value={form.photoUrl || null} onChange={photo => setForm(prev => ({ ...prev, photoUrl: photo?.url ?? '' }))} />
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
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editor === 'edit' ? 'Änderungen speichern' : 'Person anlegen'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
