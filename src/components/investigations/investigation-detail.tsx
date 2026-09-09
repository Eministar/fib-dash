'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CalendarClock,
  ImageIcon,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'

import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import {
  INVESTIGATION_ENTRY_KIND_LABELS,
  INVESTIGATION_PERSON_ROLE_LABELS,
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
} from '@/lib/investigations'
import { formatDateTime } from '@/lib/utils'
import { ClipCard, ClipPlayer } from '@/components/investigations/clip-player'
import { ClipUploadDialog } from '@/components/investigations/clip-upload-dialog'
import { InvestigationAssignees } from '@/components/investigations/investigation-assignees'
import { InvestigationEvidence } from '@/components/investigations/investigation-evidence'
import { InvestigationLinks } from '@/components/investigations/investigation-links'
import { InvestigationVehicles } from '@/components/investigations/investigation-vehicles'
import { InvestigationDossiers } from '@/components/investigations/dossiers-workspace'
import { SpotPickerField } from '@/components/map/spot-picker'
import { InvestigationHistory } from '@/components/investigations/investigation-history'
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu'
import { ImageLightbox, LightboxThumb } from '@/components/ui/image-lightbox'
import { SectionCard } from '@/components/ui/section-card'
import { TabBar, resolveTab, type TabItem } from '@/components/ui/tab-bar'
import { PhotoPicker } from '@/components/investigations/photo-catalog'
import { mapCategory } from '@/lib/map-spots'
import {
  ClassifiedBadge,
  EntryKindBadge,
  PriorityBadge,
  RoleBadge,
  StatusBadge,
  labelOptions,
} from '@/components/investigations/investigation-badges'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type {
  AgentLite,
  BodycamClip,
  InvestigationDetail as InvestigationDetailData,
  Person,
} from '@/components/investigations/types'

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

type EntryForm = {
  kind: string
  title: string
  content: string
  occurredAt: string
  location: string
}

function emptyEntryForm(): EntryForm {
  return { kind: 'OPERATION', title: '', content: '', occurredAt: localDateTimeValue(), location: '' }
}

export function InvestigationDetail({ investigationId }: { investigationId: string }) {
  const { user } = useAuth()
  const router = useRouter()
  const query = useSearchParams()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading: saving } = useApi()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')
  const canDelete = hasPermission(user, 'investigations:delete')

  const { data, loading, error, refetch } = useFetch<InvestigationDetailData>(
    canView ? `/api/investigations/${investigationId}` : null,
  )
  const { data: agents } = useFetch<AgentLite[]>(canManage ? '/api/agents' : null)
  const { data: persons } = useFetch<Person[]>(canManage ? '/api/persons' : null)

  const [entryOpen, setEntryOpen] = useState(false)
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm)
  const [personOpen, setPersonOpen] = useState(false)
  const [personId, setPersonId] = useState('')
  const [personRole, setPersonRole] = useState('SUSPECT')
  const [personNote, setPersonNote] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [activeClip, setActiveClip] = useState<BodycamClip | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState<'spots' | 'photos' | null>(null)
  const [lightboxId, setLightboxId] = useState<string | null>(null)

  const personOptions = useMemo(
    () => [
      { value: '', label: 'Person wählen' },
      ...(persons ?? []).map((person) => ({
        value: person.id,
        label: `${person.lastName}, ${person.firstName}${person.alias ? ` „${person.alias}"` : ''} (${person.personNumber})`,
      })),
    ],
    [persons],
  )

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />
  if (error || !data) {
    return (
      <Card className="py-14 text-center">
        <p className="text-[13.5px] text-[#a6a6a6]">{error || 'Ermittlungsakte nicht gefunden.'}</p>
        <Link href="/investigations" className="mt-3 inline-block text-[12.5px] text-[#c4b5fd] hover:underline">
          Zurück zur Übersicht
        </Link>
      </Card>
    )
  }

  const investigation = data

  const photoImages = investigation.photos.map((photo) => ({
    id: photo.id,
    title: photo.title,
    url: `/api/investigations/photos/${photo.id}/image`,
  }))

  const tabs: TabItem[] = [
    { id: 'chronologie', label: 'Chronologie', count: investigation.entries.length },
    {
      id: 'beteiligte',
      label: 'Beteiligte',
      count: investigation.persons.length + investigation.vehicles.length,
    },
    { id: 'medien', label: 'Medien', count: investigation.photos.length + investigation.clips.length },
    { id: 'asservate', label: 'Asservate', count: investigation.evidence.length },
    {
      id: 'verknuepfungen',
      label: 'Verknüpfungen',
      count: investigation.mapSpots.length + investigation.linksFrom.length + investigation.linksTo.length,
    },
    { id: 'verlauf', label: 'Verlauf' },
  ]
  const activeTab = resolveTab(query.get('tab'), tabs)

  // Der Reiter steht in der URL, damit ein Reload oder ein geteilter Link an
  // derselben Stelle landet. `replace` statt `push`: die Zurück-Taste soll
  // zur Aktenliste führen, nicht durch fünf Reiter zurückstolpern.
  const selectTab = (id: string) => {
    const params = new URLSearchParams(query.toString())
    params.set('tab', id)
    router.replace(`?${params}`, { scroll: false })
  }

  const factRows: [string, string][] = [
    [
      'Fallführung',
      investigation.leadAgent
        ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName} (${investigation.leadAgent.badgeNumber})`
        : 'nicht zugewiesen',
    ],
    ['Ermittler', investigation.assignees.length ? `${investigation.assignees.length} zugewiesen` : 'keine'],
    ['Angelegt', formatDateTime(investigation.createdAt)],
    [
      investigation.closedAt ? 'Abgeschlossen' : 'Aktualisiert',
      formatDateTime(investigation.closedAt ?? investigation.updatedAt),
    ],
  ]


  const patchInvestigation = async (body: Record<string, unknown>, message: string) => {
    try {
      await execute(`/api/investigations/${investigationId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      toastSuccess('Akte aktualisiert', message)
      await refetch()
    } catch (cause) {
      toastError('Aktualisieren fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleAddEntry = async () => {
    if (!entryForm.title.trim()) {
      toastError('Titel fehlt', 'Bitte einen Titel für den Eintrag angeben.')
      return
    }

    try {
      await execute(`/api/investigations/${investigationId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          kind: entryForm.kind,
          title: entryForm.title,
          content: entryForm.content,
          location: entryForm.location,
          occurredAt: entryForm.occurredAt ? new Date(entryForm.occurredAt).toISOString() : null,
        }),
      })
      toastSuccess('Eintrag hinzugefügt', 'Der Chronologie-Eintrag wurde gespeichert.')
      setEntryOpen(false)
      setEntryForm(emptyEntryForm())
      await refetch()
    } catch (cause) {
      toastError('Speichern fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleDeleteEntry = async (entryId: string, title: string) => {
    if (!window.confirm(`Eintrag "${title}" wirklich löschen? Zugehörige Clips bleiben an der Akte.`)) return

    try {
      await execute(`/api/investigations/entries/${entryId}`, { method: 'DELETE' })
      toastSuccess('Eintrag gelöscht', `"${title}" wurde entfernt.`)
      await refetch()
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleLinkPerson = async () => {
    if (!personId) {
      toastError('Keine Person', 'Bitte eine Person auswählen.')
      return
    }

    try {
      await execute(`/api/investigations/${investigationId}/persons`, {
        method: 'POST',
        body: JSON.stringify({ personId, role: personRole, note: personNote }),
      })
      toastSuccess('Person verknüpft', 'Die Person wurde der Akte zugeordnet.')
      setPersonOpen(false)
      setPersonId('')
      setPersonNote('')
      await refetch()
    } catch (cause) {
      toastError('Verknüpfen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleUnlinkPerson = async (linkId: string, name: string) => {
    try {
      await execute(`/api/investigations/persons/${linkId}`, { method: 'DELETE' })
      toastSuccess('Verknüpfung gelöst', `${name} wurde aus der Akte entfernt.`)
      await refetch()
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleDeleteClip = async (clip: BodycamClip) => {
    if (!window.confirm(`Clip "${clip.title}" endgültig löschen? Die Videodatei wird dabei entfernt.`)) return

    try {
      await execute(`/api/investigations/clips/${clip.id}`, { method: 'DELETE' })
      toastSuccess('Clip gelöscht', `"${clip.title}" wurde entfernt.`)
      setActiveClip(null)
      await refetch()
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleDeleteInvestigation = async () => {
    if (
      !window.confirm(
        `Akte ${investigation.caseNumber} mit allen Einträgen und ${investigation.clips.length} Clips endgültig löschen?`,
      )
    ) {
      return
    }

    try {
      await execute(`/api/investigations/${investigationId}`, { method: 'DELETE' })
      toastSuccess('Akte gelöscht', `${investigation.caseNumber} wurde entfernt.`)
      window.location.href = '/investigations'
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  // Nach den Handlern, weil das Menü sie referenziert.
  const menuItems: ActionMenuItem[] = [
    { id: 'clip', label: 'Clip hochladen', icon: Upload, onSelect: () => setUploadOpen(true) },
    { id: 'person', label: 'Person verknüpfen', icon: UserPlus, onSelect: () => setPersonOpen(true) },
    { id: 'edit', label: 'Akte bearbeiten', icon: Pencil, onSelect: () => setSettingsOpen(true) },
    ...(canDelete
      ? [{ id: 'delete', label: 'Akte löschen', icon: Trash2, danger: true, onSelect: handleDeleteInvestigation }]
      : []),
  ]

  return (
    <div className="mx-auto max-w-5xl pb-2">
      <Link
        href="/investigations"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-[#a6a6a6] hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Einsatzakten
      </Link>

      <div className="mb-5 rounded-[14px] border border-[#2a2a2a] bg-[#141414] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[12px] text-[#d4af37]">{investigation.caseNumber}</span>
            <h1 className="mt-1 text-[19px] font-semibold leading-tight text-white">{investigation.title}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={investigation.status} />
              <PriorityBadge priority={investigation.priority} />
              {investigation.classified && <ClassifiedBadge />}
            </div>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <Button onClick={() => setEntryOpen(true)}>
                <Plus className="h-4 w-4" />
                Eintrag hinzufügen
              </Button>
              <ActionMenu items={menuItems} />
            </div>
          )}
        </div>

        {investigation.summary && (
          <p className="mt-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
            {investigation.summary}
          </p>
        )}

        {/* Beschriftetes Raster statt der früheren Fließtext-Zeile: wer die
            Fallführung sucht, soll nicht erst einen Satz lesen müssen. */}
        <dl className="mt-4 grid gap-x-6 gap-y-2.5 border-t border-[#232323] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {factRows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-[#6a6a6a]">{label}</dt>
              <dd className="mt-0.5 truncate text-[12.5px] text-[#d4d4d4]" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <TabBar tabs={tabs} active={activeTab} onSelect={selectTab} label="Bereiche der Akte" />

      {activeTab === 'chronologie' && (
        <SectionCard
          title="Chronologie"
          count={investigation.entries.length}
          empty="Noch keine Einträge in dieser Akte. Jeder Einsatz und jeder Ermittlungsschritt gehört hierher."
          action={
            canManage ? (
              <Button variant="ghost" size="sm" onClick={() => setEntryOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Eintrag
              </Button>
            ) : null
          }
        >
          <ol className="space-y-3">
            {investigation.entries.map((entry) => (
              <li key={entry.id} className="rounded-[10px] border border-[#232323] bg-[#111111] p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <EntryKindBadge kind={entry.kind} />
                      <h3 className="text-[13.5px] font-semibold text-white">{entry.title}</h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#6a6a6a]">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {formatDateTime(entry.occurredAt)}
                      </span>
                      {entry.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {entry.location}
                        </span>
                      )}
                      {entry.createdBy && <span>Erfasst von {entry.createdBy.displayName}</span>}
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry.id, entry.title)}
                      className="shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                      aria-label="Eintrag löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {entry.content && (
                  <p className="mt-2.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#c4c4c4]">
                    {entry.content}
                  </p>
                )}

                {entry.clips.length > 0 && (
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                    {entry.clips.map((clip) => (
                      <ClipCard key={clip.id} clip={clip} onOpen={setActiveClip} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {activeTab === 'beteiligte' && (
        <>
          <InvestigationAssignees
            investigationId={investigationId}
            assignees={investigation.assignees}
            leadAgent={investigation.leadAgent}
            classified={investigation.classified}
            agents={agents ?? []}
            canManage={canManage}
            onChanged={refetch}
          />

          <SectionCard
            title="Beteiligte Personen"
            count={investigation.persons.length}
            empty="Noch keine Personen zugeordnet."
            action={
              canManage ? (
                <Button variant="ghost" size="sm" onClick={() => setPersonOpen(true)}>
                  <UserPlus className="h-3.5 w-3.5" />
                  Verknüpfen
                </Button>
              ) : null
            }
          >
            <ul className="divide-y divide-[#232323]">
              {investigation.persons.map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/investigations/persons?person=${link.person.id}`}
                        className="text-[13.5px] font-medium text-white hover:underline"
                      >
                        {link.person.firstName} {link.person.lastName}
                      </Link>
                      <RoleBadge role={link.role} />
                      <span className="font-mono text-[11px] text-[#6a6a6a]">{link.person.personNumber}</span>
                    </div>
                    {link.note && <p className="mt-0.5 text-[12px] text-[#a6a6a6]">{link.note}</p>}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        handleUnlinkPerson(link.id, `${link.person.firstName} ${link.person.lastName}`)
                      }
                      className="shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                      aria-label="Verknüpfung lösen"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>

          <InvestigationVehicles
            investigationId={investigationId}
            vehicles={investigation.vehicles}
            canManage={canManage}
            onChanged={refetch}
          />
        </>
      )}

      {activeTab === 'medien' && (
        <>
          <SectionCard
            title="Bilder"
            count={investigation.photos.length}
            empty="Noch keine Bilder zu dieser Akte."
            action={
              canManage ? (
                <Button variant="ghost" size="sm" onClick={() => setLinkOpen('photos')}>
                  <ImageIcon className="h-3.5 w-3.5" />
                  Bilder verwalten
                </Button>
              ) : null
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photoImages.map((photo) => (
                <LightboxThumb key={photo.id} image={photo} onOpen={setLightboxId} />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Bodycam-Clips"
            count={investigation.clips.length}
            empty="Noch keine Clips zu dieser Akte."
            action={
              canManage ? (
                <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-3.5 w-3.5" />
                  Hochladen
                </Button>
              ) : null
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {investigation.clips.map((clip) => (
                <ClipCard key={clip.id} clip={clip} onOpen={setActiveClip} />
              ))}
            </div>
          </SectionCard>
        </>
      )}

      {activeTab === 'asservate' && (
        <InvestigationEvidence
          investigationId={investigationId}
          evidence={investigation.evidence}
          entries={investigation.entries}
          agents={agents ?? []}
          canManage={canManage}
          onChanged={refetch}
        />
      )}

      {activeTab === 'verknuepfungen' && (
        <>
          <SectionCard
            title="Kartenpunkte"
            count={investigation.mapSpots.length}
            empty="Keine Kartenpunkte zu dieser Akte."
            action={
              canManage ? (
                <Button variant="ghost" size="sm" onClick={() => setLinkOpen('spots')}>
                  <MapPin className="h-3.5 w-3.5" />
                  Verknüpfen
                </Button>
              ) : null
            }
          >
            <ul className="flex flex-wrap gap-1.5">
              {investigation.mapSpots.map((spot) => (
                <li key={spot.id}>
                  <Link
                    href="/map"
                    className="flex items-center gap-1.5 rounded-full border border-[#343434] px-3 py-1.5 text-[12px] text-[#d4d4d4] hover:border-[#a78bfa]"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: mapCategory(spot.category).hex }} />
                    {spot.title}
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>

          <InvestigationLinks
            investigationId={investigationId}
            linksFrom={investigation.linksFrom}
            linksTo={investigation.linksTo}
            canManage={canManage}
            onChanged={refetch}
          />

          <Card className="mb-4">
            <InvestigationDossiers investigationId={investigationId} />
          </Card>
        </>
      )}

      {activeTab === 'verlauf' && <InvestigationHistory investigationId={investigationId} />}

      <ImageLightbox images={photoImages} startId={lightboxId} onClose={() => setLightboxId(null)} />

      <Modal
        open={linkOpen !== null}
        onClose={() => setLinkOpen(null)}
        title={linkOpen === 'photos' ? 'Bilder verknüpfen' : 'Kartenpunkte verknüpfen'}
        size="xl"
      >
        {linkOpen === 'spots' && (
          <SpotPickerField
            value={investigation.mapSpots}
            canCreate={hasPermission(user, 'map:manage')}
            onChange={async (spots) => {
              await execute(`/api/investigations/${investigationId}`, {
                method: 'PATCH',
                body: JSON.stringify({ mapSpotIds: spots.map((spot) => spot.id) }),
              })
              await refetch()
            }}
          />
        )}
        {linkOpen === 'photos' && (
          <PhotoPicker
            value={photoImages}
            onChange={async (photos) => {
              await execute(`/api/investigations/${investigationId}`, {
                method: 'PATCH',
                body: JSON.stringify({ photoIds: photos.map((photo) => photo.id) }),
              })
              await refetch()
            }}
          />
        )}
        <div className="mt-5 flex justify-end border-t border-[#232323] pt-4">
          <Button onClick={() => setLinkOpen(null)}>Fertig</Button>
        </div>
      </Modal>

      <ClipPlayer
        clip={activeClip}
        onClose={() => setActiveClip(null)}
        onDelete={canManage ? handleDeleteClip : undefined}
      />

      <ClipUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        investigationId={investigationId}
        entries={investigation.entries}
        agents={agents ?? []}
        onUploaded={() => void refetch()}
      />

      {/* Eintrag anlegen */}
      <Modal
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title="Chronologie-Eintrag"
        description="Ein Einsatz oder Ermittlungsschritt innerhalb dieser Akte."
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Art"
              options={labelOptions(INVESTIGATION_ENTRY_KIND_LABELS)}
              value={entryForm.kind}
              onValueChange={(value) => setEntryForm((prev) => ({ ...prev, kind: value }))}
            />
            <Input
              label="Zeitpunkt"
              type="datetime-local"
              value={entryForm.occurredAt}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, occurredAt: event.target.value }))}
            />
          </div>
          <Input
            label="Titel"
            value={entryForm.title}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="z. B. Zugriff Lagerhalle"
          />
          <Input
            label="Ort"
            value={entryForm.location}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, location: event.target.value }))}
            placeholder="z. B. Elysian Island"
          />
          <Textarea
            label="Hergang / Feststellungen"
            value={entryForm.content}
            onChange={(event) => setEntryForm((prev) => ({ ...prev, content: event.target.value }))}
            rows={5}
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEntryOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAddEntry} loading={saving}>
              Eintrag speichern
            </Button>
          </div>
        </div>
      </Modal>

      {/* Person verknüpfen */}
      <Modal
        open={personOpen}
        onClose={() => setPersonOpen(false)}
        title="Person verknüpfen"
        description="Personen kommen aus dem fallübergreifenden Register."
        size="lg"
      >
        <div className="space-y-4">
          <Select label="Person" options={personOptions} value={personId} onValueChange={setPersonId} />
          <Select
            label="Rolle"
            options={labelOptions(INVESTIGATION_PERSON_ROLE_LABELS)}
            value={personRole}
            onValueChange={setPersonRole}
          />
          <Textarea
            label="Notiz"
            value={personNote}
            onChange={(event) => setPersonNote(event.target.value)}
            rows={3}
            placeholder="Bezug zur Ermittlung"
          />

          <div className="flex items-center justify-between pt-1">
            <Link href="/investigations/persons" className="text-[12px] text-[#c4b5fd] hover:underline">
              Neue Person anlegen
            </Link>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPersonOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleLinkPerson} loading={saving}>
                Verknüpfen
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Akte bearbeiten */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Akte bearbeiten"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Status"
              options={labelOptions(INVESTIGATION_STATUS_LABELS)}
              value={investigation.status}
              onValueChange={(value) =>
                void patchInvestigation({ status: value }, 'Der Status wurde geändert.')
              }
            />
            <Select
              label="Priorität"
              options={labelOptions(INVESTIGATION_PRIORITY_LABELS)}
              value={investigation.priority}
              onValueChange={(value) =>
                void patchInvestigation({ priority: value }, 'Die Priorität wurde geändert.')
              }
            />
          </div>

          <Select
            label="Fallführung"
            options={[
              { value: '', label: 'Keine Fallführung' },
              ...(agents ?? []).map((agent) => ({
                value: agent.id,
                label: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
              })),
            ]}
            value={investigation.leadAgent?.id ?? ''}
            onValueChange={(value) =>
              void patchInvestigation({ leadAgentId: value || null }, 'Die Fallführung wurde geändert.')
            }
          />

          <Checkbox
            checked={investigation.classified}
            onCheckedChange={(checked) =>
              void patchInvestigation(
                { classified: checked },
                checked ? 'Die Akte ist jetzt eine Verschlusssache.' : 'Die Akte ist nicht mehr vertraulich.',
              )
            }
            label="Verschlusssache"
          />

          <div className="flex justify-end pt-1">
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Schließen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
