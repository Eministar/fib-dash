'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FileVideo, FolderOpen, Plus, Search, Users } from 'lucide-react'

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
import { Wizard, type WizardStep } from '@/components/ui/wizard'
import { SpotPickerField, type PickedSpot } from '@/components/map/spot-picker'
import { PhotoPicker, type CatalogPhoto } from '@/components/investigations/photo-catalog'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type { AgentLite, InvestigationListItem } from '@/components/investigations/types'

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
  const { user } = useAuth()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading: saving } = useApi()

  const canView = hasPermission(user, 'investigations:view')
  const canManage = hasPermission(user, 'investigations:manage')
  const canPlaceSpots = hasPermission(user, 'map:manage')

  const [status, setStatus] = useState('OPEN_ONLY')
  const [priority, setPriority] = useState('ALL')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyForm)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (status !== 'ALL') params.set('status', status)
    if (priority !== 'ALL') params.set('priority', priority)
    if (search.trim()) params.set('search', search.trim())
    const suffix = params.toString()
    return `/api/investigations${suffix ? `?${suffix}` : ''}`
  }, [status, priority, search])

  const { data, loading, refetch } = useFetch<InvestigationListItem[]>(canView ? query : null)
  const { data: agents } = useFetch<AgentLite[]>(canManage ? '/api/agents' : null)

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'Keine Fallführung' },
      ...(agents ?? []).map((agent) => ({
        value: agent.id,
        label: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
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
      await execute('/api/investigations', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
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
    } catch (cause) {
      toastError('Anlegen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const investigations = data ?? []

  const steps: WizardStep[] = [
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
          <div className="rounded-[10px] border border-[#2a2a2a] bg-[#141414] p-3.5">
            <Checkbox
              checked={form.classified}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, classified: checked }))}
              label="Als Verschlusssache führen"
            />
            <p className="mt-2 text-[12px] leading-relaxed text-[#a6a6a6]">
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
          <p className="text-[12.5px] text-[#a6a6a6]">
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
          <p className="text-[12.5px] text-[#a6a6a6]">
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
            <div key={label} className="flex flex-wrap gap-x-3 border-b border-[#1e1e1e] pb-2">
              <dt className="w-36 shrink-0 text-[#808080]">{label}</dt>
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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Neue Akte
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#808080]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Aktenzeichen, Titel, Person oder Fallführung"
            className="pl-9"
          />
        </div>
        <Select options={STATUS_FILTER_OPTIONS} value={status} onValueChange={setStatus} />
        <Select options={PRIORITY_FILTER_OPTIONS} value={priority} onValueChange={setPriority} />
      </div>

      {loading ? (
        <PageLoader />
      ) : investigations.length === 0 ? (
        <Card className="py-14 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-[#4a4a4a]" />
          <p className="mt-3 text-[13.5px] text-[#a6a6a6]">Keine Ermittlungsakten gefunden.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {investigations.map((investigation) => (
            <Link
              key={investigation.id}
              href={`/investigations/${investigation.id}`}
              className={cn(
                'block rounded-[12px] border border-[#2a2a2a] bg-[#141414] p-4 transition-colors',
                'hover:border-[#404040] hover:bg-[#181818]',
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
                    <p className="mt-1 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-[#a6a6a6]">
                      {investigation.summary}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4 text-[12px] text-[#808080]">
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

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[#6a6a6a]">
                <span>
                  Fallführung:{' '}
                  {investigation.leadAgent
                    ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName} (${investigation.leadAgent.badgeNumber})`
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
