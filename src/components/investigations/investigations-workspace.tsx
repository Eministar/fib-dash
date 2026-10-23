'use client'

import { displayBadgeNumber } from '@/lib/agents/badge-number'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePageAction } from '@/hooks/use-page-action'
import { FileVideo, FolderOpen, ListChecks, Plus, Users } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
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
} from '@/lib/investigations/investigations'
import { cn, formatDateTime } from '@/lib/utils'
import {
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
import { checklistProgress, composeTitle, templatePrefill, mergeTemplatePrefill, type InvestigationTemplateData } from '@/lib/investigations/investigation-templates'
import { SavedViews } from '@/components/ui/saved-views'
import { AiSuggest } from '@/components/ai/ai-suggest'
import {
  defaultInvestigationFilters,
  readInvestigationViews,
  sameInvestigationFilters,
  validInvestigationViews,
  type InvestigationViewFilters,
} from '@/lib/investigations/investigation-saved-views'

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Alle Status' },
  { value: 'OPEN_ONLY', label: 'Nur laufende' },
  ...labelOptions(INVESTIGATION_STATUS_LABELS),
]

const SCOPE_FILTER_OPTIONS = [
  { value: 'all', label: 'Alle Akten' },
  { value: 'mine', label: 'Meine Akten' },
]

const PRIORITY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'Alle Prioritäten' },
  ...labelOptions(INVESTIGATION_PRIORITY_LABELS),
]

type CreateForm = {
  /** Gewählte Aktenvorlage ('' = ohne Vorlage). */
  templateId: string
  title: string
  dossierId: string
  affiliation: '' | 'yes' | 'no'
  summary: string
  status: string
  priority: string
  leadAgentId: string
  assigneeIds: string[]
  mapSpots: PickedSpot[]
  photos: CatalogPhoto[]
}

function emptyForm(): CreateForm {
  return {
    templateId: '',
    title: '',
    dossierId: '',
    affiliation: '',
    summary: '',
    status: 'OPEN',
    priority: 'NORMAL',
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

  const [status, setStatus] = useState<InvestigationViewFilters['status']>('OPEN_ONLY')
  const [priority, setPriority] = useState<InvestigationViewFilters['priority']>('ALL')
  const [mine, setMine] = useUrlState('mine', '')
  const [search, setSearch] = useUrlState('q', '')
  const filters: InvestigationViewFilters = { search, status, priority, mine: mine === '1' }
  const applyFilters = (next: InvestigationViewFilters) => {
    setSearch(next.search)
    setStatus(next.status)
    setPriority(next.priority)
    setMine(next.mine ? '1' : '')
  }
  const debouncedSearch = useDebouncedValue(search)
  const [createOpen, setCreateOpen] = useState(false)
  const [chooseType, setChooseType] = useState(false)
  const [dossierSearch, setDossierSearch] = useState('')
  const [form, setForm] = useState<CreateForm>(emptyForm)
  usePageAction('new', () => setCreateOpen(true), canManage)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (status !== 'ALL') params.set('status', status)
    if (priority !== 'ALL') params.set('priority', priority)
    if (mine === '1') params.set('mine', '1')
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const suffix = params.toString()
    return `/api/investigations${suffix ? `?${suffix}` : ''}`
  }, [status, priority, mine, debouncedSearch])

  const { data, loading, refetch } = useFetch<InvestigationListItem[]>(canView ? query : null)
  const { data: agents } = useFetch<AgentLite[]>(canManage && createOpen ? '/api/investigations/agents' : null)
  const { data: templates, loading: templatesLoading, error: templatesError } = useFetch<InvestigationTemplateData[]>(canManage && createOpen ? '/api/investigation-templates' : null)
  const selectedTemplate = templates?.find((template) => template.id === form.templateId) ?? null
  // Was die zuletzt gewählte Vorlage vorausgefüllt hat. Nur solange Titel und
  // Zusammenfassung unverändert sind, darf ein Vorlagenwechsel sie ersetzen.
  const [prefill, setPrefill] = useState(() => templatePrefill(null))

  const applyTemplate = (template: InvestigationTemplateData | null) => {
    const next = templatePrefill(template, agents?.map(agent => agent.id))
    setForm((prev) => ({
      ...mergeTemplatePrefill(prev, prefill, next),
      templateId: template?.id ?? '',
    }))
    setPrefill(next)
  }
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
    if (!form.title.trim() || form.title.trim() === prefill.title.trim()) {
      toastError('Titel fehlt', 'Bitte einen Titel für die Akte angeben.')
      return
    }

    try {
      const created = await execute('/api/investigations', {
        method: 'POST',
        body: JSON.stringify({
          title: composeTitle(selectedTemplate?.titlePrefix, form.title),
          templateId: form.templateId || null,
          dossierId: form.affiliation === 'yes' ? form.dossierId : null,
          summary: form.summary,
          status: form.status,
          priority: form.priority,
          leadAgentId: form.leadAgentId || null,
          assigneeIds: form.assigneeIds,
          mapSpotIds: form.mapSpots.map((spot) => spot.id),
          photoIds: form.photos.map((photo) => photo.id),
        }),
      })
      toastSuccess('Akte angelegt', 'Die Ermittlungsakte wurde erstellt.')
      setCreateOpen(false)
      setForm(emptyForm())
      setPrefill(templatePrefill(null))
      await refetch()
      if (created && typeof created === 'object' && 'id' in created) router.push(`/investigations/${created.id}`)
    } catch (cause) {
      toastError('Anlegen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const investigations = data ?? []
  // „Nur laufende“ ist die Voreinstellung und blendet abgeschlossene Akten
  // aus – der Leerzustand muss das erklären, sonst sucht man vergeblich.
  const filtered = Boolean(search.trim()) || status !== 'ALL' || priority !== 'ALL' || mine === '1'

  const steps: WizardStep[] = [
    {
      id: 'vorlage',
      label: 'Vorlage',
      content: (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-[#98989d]">
            Eine Vorlage füllt Titel, Abschnitte, Priorität und Beteiligte vor und gibt der Akte eine Checkliste mit. Alles bleibt danach änderbar.
          </p>
          {templatesLoading && !templates ? (
            <ListSkeleton rows={3} compact />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {[null, ...(templates ?? [])].map((template) => {
                const active = (template?.id ?? '') === form.templateId
                const meta = template
                  ? [
                      template.checklist.length ? `${template.checklist.length} Checklistenpunkte` : null,
                      template.roles.length ? `${template.roles.length} offene Rollen` : null,
                      INVESTIGATION_PRIORITY_LABELS[template.priority],
                    ].filter(Boolean).join(' · ')
                  : 'Leere Akte, alles selbst ausfüllen'
                return (
                  <button
                    key={template?.id ?? 'none'}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyTemplate(template)}
                    className={cn(
                      'rounded-[10px] border p-3.5 text-left transition-colors',
                      active ? 'border-[#0a84ff] bg-[#0a84ff]/10' : 'border-[#38383a] hover:border-[#48484a] hover:bg-[#1c1c1e]',
                    )}
                  >
                    <span className="block text-[13.5px] font-semibold text-white">{template?.name ?? 'Ohne Vorlage'}</span>
                    {template?.description && <span className="mt-1 block text-[12.5px] leading-relaxed text-[#98989d]">{template.description}</span>}
                    <span className="mt-1.5 block text-[11.5px] text-[#8e8e93]">{meta}</span>
                  </button>
                )
              })}
            </div>
          )}
          {templatesError && <p role="alert" className="text-sm text-red-400">Vorlagen konnten nicht geladen werden: {templatesError}</p>}
          {templates && templates.length === 0 && (
            <p className="text-[12px] text-[#8e8e93]">
              Noch keine Vorlagen vorhanden.
              {hasPermission(user, 'investigations:templates') && (
                <> <Link href="/admin/investigation-templates" className="text-[#0a84ff] hover:underline">Vorlagen anlegen</Link></>
              )}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'zusammenhang', label: 'Zusammenhang',
      invalid: !form.affiliation ? 'Bitte wähle, ob der Vorfall zu einer bekannten Familie gehört.' : form.affiliation === 'yes' && !form.dossierId ? 'Bitte die zugehörige Familienakte auswählen.' : undefined,
      content: <div className="space-y-4">
        <h2 className="text-base font-semibold">Gehört der Vorfall zu einer Fraktion, Familie oder einem bekannten Anwesen?</h2>
        <p className="text-sm leading-6 text-[#98989d]">Die Einsatzakte dokumentiert diesen konkreten Vorfall. Eine Familienakte sammelt alle Einsätze, Mitglieder und Fahrzeuge einer Familie über längere Zeit.</p>
        <div className="grid gap-2 sm:grid-cols-2">{[
          { id: 'yes' as const, label: 'Ja, einer Familienakte zuordnen' },
          { id: 'no' as const, label: 'Nein oder noch unbekannt' },
        ].map(option => <button type="button" key={option.id} aria-pressed={form.affiliation === option.id}
          className={`rounded-lg border p-3 text-left text-sm ${form.affiliation === option.id ? 'border-[#98989d] bg-[#3a3a3c]' : 'border-[#38383a]'}`}
          onClick={() => setForm(previous => ({ ...previous, affiliation: option.id }))}>{option.label}</button>)}</div>
        {form.affiliation === 'yes' && <>
          <Input label="Familie suchen" value={dossierSearch} onChange={event => setDossierSearch(event.target.value)} placeholder="Name der Familie, des Leiters oder eines Mitglieds" />
          {dossiers.error && <p role="alert" className="text-sm text-red-300">{dossiers.error}</p>}
          <Select label="Zugehörige Familienakte" value={form.dossierId} onValueChange={value => setForm(previous => ({ ...previous, dossierId: value }))}
            options={[{ value: '', label: dossiers.loading ? 'Akten werden geladen …' : 'Familienakte auswählen' }, ...(dossiers.data?.items ?? []).map(item => ({ value: item.id, label: item.title }))]} />
          <Link href="/investigations/dossiers?new=1" target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-[#c4b5fd] underline">Neue Familienakte in einem weiteren Tab anlegen</Link>
        </>}
      </div>,
    },
    {
      id: 'anlass',
      label: 'Anlass',
      // Nur das Präfix der Vorlage („Drogen –“) ist noch kein Titel.
      invalid: form.title.trim() && form.title.trim() !== prefill.title.trim() ? undefined : 'Bitte einen Titel für die Akte angeben.',
      content: (
        <div className="space-y-4">
          <AiSuggest
            kind="investigation"
            dossierId={form.affiliation === 'yes' ? form.dossierId : null}
            onAccept={(suggestion) => setForm((prev) => ({ ...prev, title: suggestion.title, summary: suggestion.content }))}
          />
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
          />
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
            ['Vorlage', selectedTemplate?.name ?? 'Ohne Vorlage'],
            ['Titel', composeTitle(selectedTemplate?.titlePrefix, form.title) || '—'],
            ...(selectedTemplate
              ? [
                  ['Checkliste', selectedTemplate.checklist.length ? `${selectedTemplate.checklist.length} Punkte` : 'Keine'],
                  ['Offene Rollen', selectedTemplate.roles.length ? selectedTemplate.roles.map((role) => role.label).join(', ') : 'Keine'],
                ]
              : []),
            ['Status', INVESTIGATION_STATUS_LABELS[form.status as keyof typeof INVESTIGATION_STATUS_LABELS] ?? form.status],
            ['Priorität', INVESTIGATION_PRIORITY_LABELS[form.priority as keyof typeof INVESTIGATION_PRIORITY_LABELS] ?? form.priority],
            ['Fallführung', agentOptions.find((option) => option.value === form.leadAgentId)?.label ?? 'Keine Fallführung'],
            ['Ermittler', form.assigneeIds.length ? `${form.assigneeIds.length} zugewiesen` : 'Keine'],
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
            <Button onClick={() => setChooseType(true)} title="Neue Akte (Taste N)" aria-keyshortcuts="n">
              <Plus className="h-4 w-4" />
              Neue Akte
              <kbd className="ml-1 hidden rounded border border-white/30 px-1 font-mono text-[11px] text-white/80 lg:inline">N</kbd>
            </Button>
          ) : null
        }
      />

      {chooseType && <Modal open onClose={() => setChooseType(false)} title="Was möchtest du dokumentieren?" size="lg">
        <div className="space-y-3">
          <button type="button" onClick={() => { setChooseType(false); setCreateOpen(true) }} className="block w-full rounded-lg border border-[#48484a] p-4 text-left hover:bg-[#2c2c2e]"><span className="block font-medium">Einen konkreten Einsatz oder Vorfall</span><span className="mt-1 block text-sm text-[#98989d]">Einsatzakte mit Ablauf, Beteiligten und Beweisen anlegen.</span></button>
          <Link href="/investigations/dossiers?new=1" className="block rounded-lg border border-[#48484a] p-4 hover:bg-[#2c2c2e]"><span className="block font-medium">Informationen langfristig sammeln</span><span className="mt-1 block text-sm text-[#98989d]">Familienakte für eine Familie oder Fraktion anlegen.</span></Link>
        </div>
      </Modal>}

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Einsatzakte suchen"
          placeholder="Aktenzeichen, Titel, Person oder Fallführung"
        />
        <Select options={SCOPE_FILTER_OPTIONS} value={mine === '1' ? 'mine' : 'all'} onValueChange={(value) => setMine(value === 'mine' ? '1' : '')} />
        <Select options={STATUS_FILTER_OPTIONS} value={status} onValueChange={(value) => setStatus(value as InvestigationViewFilters['status'])} />
        <Select options={PRIORITY_FILTER_OPTIONS} value={priority} onValueChange={(value) => setPriority(value as InvestigationViewFilters['priority'])} />
      </FilterBar>

      {user && (
        <SavedViews
          storageKey={`fib:investigation-views:${user.id}`}
          filters={filters}
          defaults={defaultInvestigationFilters}
          onApply={applyFilters}
          read={readInvestigationViews}
          same={sameInvestigationFilters}
          validate={validInvestigationViews}
          defaultLabel="Laufende Akten"
          placeholder="Zum Beispiel Meine kritischen Fälle"
          hint="Speichert Suche, Zuständigkeit, Status und Priorität für dein Konto in diesem Browser."
        />
      )}

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
                onClick={() => applyFilters({ ...defaultInvestigationFilters, status: 'ALL' })}
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
          {investigations.map((investigation) => {
            const progress = checklistProgress(investigation.checklist)
            return (
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
                  </div>
                  <h2 className="mt-1.5 truncate text-[15px] font-semibold text-white">{investigation.title}</h2>
                  {investigation.summary && (
                    <p className="mt-1 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-[#98989d]">
                      {investigation.summary}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4 text-[12px] text-[#8e8e93]">
                  {progress && (
                    <span
                      className={cn('inline-flex items-center gap-1.5 tabular-nums', progress.done === progress.total && 'text-[#30d158]')}
                      title={`Arbeitsplan: ${progress.done} von ${progress.total} Schritten erledigt`}
                    >
                      <ListChecks className="h-3.5 w-3.5" aria-hidden />
                      {progress.done}/{progress.total}
                      <span className="h-1 w-10 overflow-hidden rounded-full bg-[#2c2c2e]" aria-hidden>
                        <span className="block h-full rounded-full bg-current" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                      </span>
                    </span>
                  )}
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
            )
          })}
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
