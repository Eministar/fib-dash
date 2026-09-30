'use client'

import { displayBadgeNumber } from '@/lib/badge-number'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileVideo, FolderOpen, Plus, Users } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ListSkeleton } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import {
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
} from '@/lib/investigations'
import { cn, formatDateTime } from '@/lib/utils'
import {
  ClassifiedBadge,
  PriorityBadge,
  StatusBadge,
  labelOptions,
} from '@/components/investigations/investigation-badges'
import { AgentPicker } from '@/components/investigations/agent-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterBar, SearchInput } from '@/components/ui/filter-bar'
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { PhotoPicker, type CatalogPhoto } from '@/components/investigations/photo-catalog'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type { AgentLite, InvestigationListItem } from '@/components/investigations/types'
import { useUrlState } from '@/hooks/use-url-state'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Alle Status' },
  { value: 'OPEN_ONLY', label: 'Nur laufende' },
  ...labelOptions(INVESTIGATION_STATUS_LABELS),
]

const PRIORITY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Alle Prioritäten' },
  ...labelOptions(INVESTIGATION_PRIORITY_LABELS),
]

type CreateForm = {
  title: string
  dossierId: string
  affiliation: '' | 'yes' | 'no'
  summary: string
  status: string
  priority: string
  classified: boolean
  leadAgentId: string
  assigneeIds: string[]
  mapSpots: PickedSpot[]
  photos: CatalogPhoto[]
}

/** Neue Akten sind standardmäßig Verschlusssache: die Öffnung für alle
 *  Ermittler soll eine bewusste Entscheidung sein, nicht der Normalfall. */
function emptyForm(): CreateForm {
  return {
    title: '',
    dossierId: '',
    affiliation: '',
    summary: '',
    status: 'OPEN',
    priority: 'NORMAL',
    classified: true,
    leadAgentId: '',
    assigneeIds: [],
    mapSpots: [],
    photos: [],
  }
}

export function InvestigationsWorkspace() {
  const router = useRouter()
  const { user } = useAuth()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading: saving } = useApi()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')
  const canPlaceSpots = hasPermission(user, 'map:manage')

  const [status, setStatus] = useState('OPEN_ONLY')
  const [priority, setPriority] = useState('ALL')
  const [search, setSearch] = useUrlState('q', '')
  const debouncedSearch = useDebouncedValue(search)
  const [createOpen, setCreateOpen] = useState(false)
  const [chooseType, setChooseType] = useState(false)
  const [dossierSearch, setDossierSearch] = useState('')
  const [form, setForm] = useState<CreateForm>(emptyForm)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (status !== 'ALL') params.set('status', status)
    if (priority !== 'ALL') params.set('priority', priority)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const suffix = params.toString()
    return `/api/investigations${suffix ? `?${suffix}` : ''}`
  }, [status, priority, debouncedSearch])

  const { data, loading, refetch } = useFetch<InvestigationListItem[]>(canView ? query : null)
  const { data: agents } = useFetch<AgentLite[]>(canManage && createOpen ? '/api/agents' : null)
  const dossiers = useFetch<{ items: { id: string; title: string }[] }>(createOpen && form.affiliation === 'yes' ? `/api/investigations/dossiers?search=${encodeURIComponent(dossierSearch)}` : null)

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'Keine Fallführung' },
      ...(agents ?? []).map((agent) => ({
        value: agent.id,
        label: `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})`,
      })),
    ],
    [agents],
  )

  if (!canView) return <UnauthorizedContent />

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toastError('Titel fehlt', 'Bitte einen Titel für die Akte angeben.')
      return
    }

    try {
      const created = await execute('/api/investigations', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          dossierId: form.affiliation === 'yes' ? form.dossierId : null,
          summary: form.summary,
          status: form.status,
          priority: form.priority,
          classified: form.classified,
          leadAgentId: form.leadAgentId || null,
          assigneeIds: form.assigneeIds,
          mapSpotIds: form.mapSpots.map((spot) => spot.id),
          photoIds: form.photos.map((photo) => photo.id),
        }),
      })
      toastSuccess('Akte angelegt', 'Die Ermittlungsakte wurde erstellt.')
      setCreateOpen(false)
      setForm(emptyForm())
      await refetch()
      if (created && typeof created === 'object' && 'id' in created) router.push(`/investigations/${created.id}`)
    } catch (cause) {
      toastError('Anlegen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const investigations = data ?? []
  // „Nur laufende“ ist die Voreinstellung und blendet abgeschlossene Akten
  // aus – der Leerzustand muss das erklären, sonst sucht man vergeblich.
  const filtered = Boolean(search.trim()) || status !== 'ALL' || priority !== 'ALL'

  const steps: WizardStep[] = [
    {
      id: 'zusammenhang', label: 'Zusammenhang',
      invalid: !form.affiliation ? 'Bitte wähle, ob der Vorfall zu einer bestehenden Dauerakte gehört.' : form.affiliation === 'yes' && !form.dossierId ? 'Bitte die zugehörige Dauerakte auswählen.' : undefined,
      content: <div className="space-y-4">
        <h2 className="text-base font-semibold">Gehört der Vorfall zu einer Fraktion, Familie oder einem bekannten Anwesen?</h2>
        <p className="text-sm leading-6 text-[#98989d]">Die Einsatzakte dokumentiert diesen konkreten Vorfall. Eine Dauerakte sammelt alle zugehörigen Einsätze, Personen und Fahrzeuge über längere Zeit.</p>
        <div className="grid gap-2 sm:grid-cols-2">{[
          { id: 'yes' as const, label: 'Ja, einer Dauerakte zuordnen' },
          { id: 'no' as const, label: 'Nein oder noch unbekannt' },
        ].map(option => <button type="button" key={option.id} aria-pressed={form.affiliation === option.id}
          className={`rounded-lg border p-3 text-left text-sm ${form.affiliation === option.id ? 'border-[#98989d] bg-[#3a3a3c]' : 'border-[#38383a]'}`}
          onClick={() => setForm(previous => ({ ...previous, affiliation: option.id }))}>{option.label}</button>)}</div>
        {form.affiliation === 'yes' && <>
          <Input label="Fraktion oder Dauerakte suchen" value={dossierSearch} onChange={event => setDossierSearch(event.target.value)} placeholder="Name der Fraktion, Familie oder des Anwesens" />
          {dossiers.error && <p role="alert" className="text-sm text-red-300">{dossiers.error}</p>}
          <Select label="Zugehörige Dauerakte" value={form.dossierId} onValueChange={value => setForm(previous => ({ ...previous, dossierId: value }))}
            options={[{ value: '', label: dossiers.loading ? 'Akten werden geladen …' : 'Dauerakte auswählen' }, ...(dossiers.data?.items ?? []).map(item => ({ value: item.id, label: item.title }))]} />
          <Link href="/investigations/dossiers?new=1&kind=FAMILY" target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-[#c4b5fd] underline">Neue Fraktionsakte in einem weiteren Tab anlegen</Link>
        </>}
      </div>,
    },
    {
      id: 'anlass',
      label: 'Anlass',
      invalid: form.title.trim() ? undefined : 'Bitte einen Titel für die Akte angeben.',
      content: (
        <div className="space-y-4">
          <Input
            label="Titel"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="z. B. Waffenhandel Sandy Shores"
          />
          <Textarea
            label="Zusammenfassung"
            value={form.summary}
            onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
            placeholder="Ermittlungslage, Anlass, erste Erkenntnisse"
            rows={4}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Status"
              options={labelOptions(INVESTIGATION_STATUS_LABELS)}
              value={form.status}
              onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
            />
            <Select
              label="Priorität"
              options={labelOptions(INVESTIGATION_PRIORITY_LABELS)}
              value={form.priority}
              onValueChange={(value) => setForm((prev) => ({ ...prev, priority: value }))}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'zustaendigkeit',
      label: 'Zuständigkeit',
      content: (
        <div className="space-y-4">
          <Select
            label="Fallführung"
            options={agentOptions}
            value={form.leadAgentId}
            onValueChange={(value) => setForm((prev) => ({ ...prev, leadAgentId: value }))}
          />
          <AgentPicker
            agents={agents ?? []}
            value={form.assigneeIds}
            onChange={(assigneeIds) => setForm((prev) => ({ ...prev, assigneeIds }))}
            description="Zugewiesene Ermittler sehen die Akte auch dann, wenn sie als Verschlusssache geführt wird."
          />
          <div className="rounded-[10px] border border-[#3a3a3c] bg-[#161617] p-3.5">
            <Checkbox
              checked={form.classified}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, classified: checked }))}
              label="Als Verschlusssache führen"
            />
            <p className="mt-2 text-[12px] leading-relaxed text-[#98989d]">
              {form.classified
                ? 'Voreingestellt. Nur Ersteller, Fallführung, zugewiesene Ermittler und Berechtigte sehen die Akte samt Clips.'
                : 'Abgewählt: die Akte ist für alle Ermittler mit Akteneinsicht sichtbar.'}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'karte',
      label: 'Kartenpunkte',
      optional: true,
      content: (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#98989d]">
            Fand der Einsatz an einer bekannten Route, einem Sammler oder einem Anwesen statt? Verknüpfe die Punkte hier.
          </p>
          <SpotPickerField
            value={form.mapSpots}
            onChange={(mapSpots) => setForm((prev) => ({ ...prev, mapSpots }))}
            canCreate={canPlaceSpots}
          />
        </div>
      ),
    },
    {
      id: 'bilder',
      label: 'Bilder',
      optional: true,
      content: (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#98989d]">
            Bilder landen im Bildkatalog und lassen sich danach auch an Personen- und Anwesenakten verwenden.
          </p>
          <PhotoPicker value={form.photos} onChange={(photos) => setForm((prev) => ({ ...prev, photos }))} />
        </div>
      ),
    },
    {
      id: 'pruefen',
      label: 'Prüfen',
      content: (
        <dl className="grid gap-2.5 text-[12.5px]">
          {([
            ['Titel', form.title || '—'],
            ['Status', INVESTIGATION_STATUS_LABELS[form.status as keyof typeof INVESTIGATION_STATUS_LABELS] ?? form.status],
            ['Priorität', INVESTIGATION_PRIORITY_LABELS[form.priority as keyof typeof INVESTIGATION_PRIORITY_LABELS] ?? form.priority],
            ['Fallführung', agentOptions.find((option) => option.value === form.leadAgentId)?.label ?? 'Keine Fallführung'],
            ['Ermittler', form.assigneeIds.length ? `${form.assigneeIds.length} zugewiesen` : 'Keine'],
            ['Verschlusssache', form.classified ? 'Ja' : 'Nein'],
            ['Kartenpunkte', form.mapSpots.length ? form.mapSpots.map((spot) => spot.title).join(', ') : 'Keine'],
            ['Bilder', form.photos.length ? `${form.photos.length} ausgewählt` : 'Keine'],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1c1c1e] pb-2">
              <dt className="w-36 shrink-0 text-[#8e8e93]">{label}</dt>
              <dd className="min-w-0 text-[#d4d4d4]">{value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <InvestigationsNavigation active="cases" />

      <PageHeader
        eyebrow="Ermittlungen"
        title="Einsatzakten"
        description="Ermittlungsakten mit Einsatzchronologie, beteiligten Personen und Bodycam-Aufnahmen."
        action={
          canManage ? (
            <Button onClick={() => setChooseType(true)}>
              <Plus className="h-4 w-4" />
              Neue Akte
            </Button>
          ) : null
        }
      />

      {chooseType && <Modal open onClose={() => setChooseType(false)} title="Was möchtest du dokumentieren?" size="lg">
        <div className="space-y-3">
          <button type="button" onClick={() => { setChooseType(false); setCreateOpen(true) }} className="block w-full rounded-lg border border-[#48484a] p-4 text-left hover:bg-[#2c2c2e]"><span className="block font-medium">Einen konkreten Einsatz oder Vorfall</span><span className="mt-1 block text-sm text-[#98989d]">Einsatzakte mit Ablauf, Beteiligten und Beweisen anlegen.</span></button>
          <Link href="/investigations/dossiers?new=1" className="block rounded-lg border border-[#48484a] p-4 hover:bg-[#2c2c2e]"><span className="block font-medium">Informationen langfristig sammeln</span><span className="mt-1 block text-sm text-[#98989d]">Dauerakte für eine Fraktion, Familie, ein Anwesen oder Thema anlegen.</span></Link>
        </div>
      </Modal>}

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Einsatzakte suchen"
          placeholder="Aktenzeichen, Titel, Person oder Fallführung"
        />
        <Select options={STATUS_FILTER_OPTIONS} value={status} onValueChange={setStatus} />
        <Select options={PRIORITY_FILTER_OPTIONS} value={priority} onValueChange={setPriority} />
      </FilterBar>

      {loading && !data ? (
        <ListSkeleton rows={6} />
      ) : investigations.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={filtered ? 'Keine Akte passt zu diesem Filter.' : 'Noch keine Einsatzakten.'}
          hint={
            filtered
              ? 'Der Status steht standardmäßig auf „Nur laufende“ – abgeschlossene Akten sind damit ausgeblendet.'
              : 'Eine Einsatzakte bündelt Chronologie, Beteiligte, Medien und Asservate eines Falls.'
          }
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => { setSearch(''); setStatus('ALL'); setPriority('ALL') }}
              >
                Filter zurücksetzen
              </Button>
            ) : canManage ? (
              <Button onClick={() => setChooseType(true)}>
                <Plus className="h-4 w-4" />
                Neue Akte
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2.5">
          {investigations.map((investigation) => (
            <Link
              key={investigation.id}
              href={`/investigations/${investigation.id}`}
              className={cn(
                'block rounded-[12px] border border-[#3a3a3c] bg-[#161617] p-4 transition-colors',
                'hover:border-[#48484a] hover:bg-[#1c1c1e]',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-[#d4af37]">{investigation.caseNumber}</span>
                    <StatusBadge status={investigation.status} />
                    <PriorityBadge priority={investigation.priority} />
                    {investigation.classified && <ClassifiedBadge />}
                  </div>
                  <h2 className="mt-1.5 truncate text-[15px] font-semibold text-white">{investigation.title}</h2>
                  {investigation.summary && (
                    <p className="mt-1 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-[#98989d]">
                      {investigation.summary}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4 text-[12px] text-[#8e8e93]">
                  <span className="inline-flex items-center gap-1.5" title="Einträge">
                    <FolderOpen className="h-3.5 w-3.5" />
                    {investigation._count.entries}
                  </span>
                  <span className="inline-flex items-center gap-1.5" title="Clips">
                    <FileVideo className="h-3.5 w-3.5" />
                    {investigation._count.clips}
                  </span>
                  <span className="inline-flex items-center gap-1.5" title="Personen">
                    <Users className="h-3.5 w-3.5" />
                    {investigation._count.persons}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#8e8e93]">
                <span>
                  Fallführung:{' '}
                  {investigation.leadAgent
                    ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName} (${displayBadgeNumber(investigation.leadAgent.badgeNumber)})`
                    : 'nicht zugewiesen'}
                </span>
                <span>Aktualisiert {formatDateTime(investigation.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Neue Ermittlungsakte"
        description="In fünf Schritten. Das Aktenzeichen wird automatisch vergeben."
        size="xl"
      >
        <Wizard
          steps={steps}
          mode="linear"
          submitLabel="Akte anlegen"
          saving={saving}
          onCancel={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
      </Modal>
    </div>
  )
}
