'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarClock,
  MapPin,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
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

  return (
    <div className="mx-auto max-w-5xl pb-2">
      <Link
        href="/investigations"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-[#a6a6a6] hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Einsatzakten
      </Link>

      <PageHeader
        eyebrow={investigation.caseNumber}
        title={investigation.title}
        description={investigation.summary || undefined}
        action={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                Akte bearbeiten
              </Button>
              <Button onClick={() => setEntryOpen(true)}>
                <Plus className="h-4 w-4" />
                Eintrag
              </Button>
              <Button variant="secondary" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" />
                Clip
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={investigation.status} />
        <PriorityBadge priority={investigation.priority} />
        {investigation.classified && <ClassifiedBadge />}
        <span className="text-[12px] text-[#6a6a6a]">
          Fallführung:{' '}
          {investigation.leadAgent
            ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName} (${investigation.leadAgent.badgeNumber})`
            : 'nicht zugewiesen'}
        </span>
        {investigation.closedAt && (
          <span className="text-[12px] text-[#6a6a6a]">
            Abgeschlossen am {formatDateTime(investigation.closedAt)}
          </span>
        )}
      </div>

      <InvestigationAssignees
        investigationId={investigationId}
        assignees={investigation.assignees}
        leadAgent={investigation.leadAgent}
        classified={investigation.classified}
        agents={agents ?? []}
        canManage={canManage}
        onChanged={refetch}
      />

      {/* Beteiligte Personen */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-white">Beteiligte Personen</h2>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setPersonOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              Verknüpfen
            </Button>
          )}
        </div>

        {investigation.persons.length === 0 ? (
          <p className="py-3 text-[12.5px] text-[#6a6a6a]">Noch keine Personen zugeordnet.</p>
        ) : (
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
        )}
      </Card>

      {/* Chronologie */}
      <Card className="mb-5">
        <h2 className="mb-3 text-[14px] font-semibold text-white">Chronologie</h2>

        {investigation.entries.length === 0 ? (
          <p className="py-3 text-[12.5px] text-[#6a6a6a]">Noch keine Einträge in dieser Akte.</p>
        ) : (
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
        )}
      </Card>

      {/* Clips der Akte */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-white">
            Bodycam-Clips ({investigation.clips.length})
          </h2>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-3.5 w-3.5" />
              Hochladen
            </Button>
          )}
        </div>

        {investigation.clips.length === 0 ? (
          <p className="py-3 text-[12.5px] text-[#6a6a6a]">Noch keine Clips zu dieser Akte.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {investigation.clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} onOpen={setActiveClip} />
            ))}
          </div>
        )}
      </Card>

      <div className="mt-5">
        <InvestigationEvidence
          investigationId={investigationId}
          evidence={investigation.evidence}
          entries={investigation.entries}
          agents={agents ?? []}
          canManage={canManage}
          onChanged={refetch}
        />

        <InvestigationVehicles
          investigationId={investigationId}
          vehicles={investigation.vehicles}
          canManage={canManage}
          onChanged={refetch}
        />

        <InvestigationLinks
          investigationId={investigationId}
          linksFrom={investigation.linksFrom}
          linksTo={investigation.linksTo}
          canManage={canManage}
          onChanged={refetch}
        />
      </div>

      {canDelete && (
        <div className="mt-6 flex justify-end">
          <Button variant="danger" size="sm" onClick={handleDeleteInvestigation}>
            <Trash2 className="h-3.5 w-3.5" />
            Akte löschen
          </Button>
        </div>
      )}

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
