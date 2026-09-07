'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Clipboard,
  Clock,
  Copy,
  ExternalLink,
  FileQuestion,
  FileText,
  GripVertical,
  Link2,
  MoveDown,
  MoveUp,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'

type ModuleKey = 'ACADEMY' | 'HR' | 'SRU' | 'AIR_SUPPORT' | 'DETECTIVE'
type FormTestStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
type FormTestKind = 'TEST' | 'SURVEY'
type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'SCALE'

interface QuestionOptions {
  choices?: string[]
  correct?: string[]
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
}

interface FormQuestion {
  id?: string
  type: QuestionType
  title: string
  description: string | null
  required: boolean
  options: QuestionOptions | null
  points: number
  sortOrder: number
}

interface FormTest {
  id: string
  module: ModuleKey
  kind: FormTestKind
  title: string
  description: string | null
  status: FormTestStatus
  timeLimitMinutes: number | null
  anonymousResponses: boolean
  shareToken: string
  createdAt: string
  updatedAt: string
  createdBy: { id: string; displayName: string } | null
  questions: FormQuestion[]
  _count: { responses: number; questions: number }
}

interface FormTestsProps {
  module: ModuleKey
  title: string
  description: string
  canManage: boolean
}

const STATUS_META: Record<FormTestStatus, { label: string; variant: 'default' | 'success' | 'warning'; action: string }> = {
  DRAFT: { label: 'Entwurf', variant: 'warning', action: 'Aktivieren' },
  ACTIVE: { label: 'Aktiv', variant: 'success', action: 'Deaktivieren' },
  ARCHIVED: { label: 'Archiv', variant: 'default', action: 'Reaktivieren' },
}

const KIND_META: Record<FormTestKind, { label: string; variant: 'info' | 'warning'; icon: React.ReactNode }> = {
  TEST: { label: 'Test', variant: 'warning', icon: <FileQuestion size={13} /> },
  SURVEY: { label: 'Umfrage', variant: 'info', icon: <FileText size={13} /> },
}

const QUESTION_TYPE_OPTIONS = [
  { value: 'SHORT_TEXT', label: 'Kurzantwort' },
  { value: 'LONG_TEXT', label: 'Langtext' },
  { value: 'SINGLE_CHOICE', label: 'Eine Auswahl' },
  { value: 'MULTIPLE_CHOICE', label: 'Mehrfachauswahl' },
  { value: 'SCALE', label: 'Skala' },
]

const EMPTY_CREATE_FORM = {
  title: '',
  description: '',
  kind: 'TEST' as FormTestKind,
  timeLimitMinutes: '',
  anonymousResponses: false,
}

function createEmptyQuestion(): FormQuestion {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'LONG_TEXT',
    title: '',
    description: null,
    required: true,
    options: null,
    points: 0,
    sortOrder: 0,
  }
}

function defaultOptions(type: QuestionType): QuestionOptions | null {
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') return { choices: ['Option 1', 'Option 2'], correct: [] }
  if (type === 'SCALE') return { min: 1, max: 5, minLabel: '', maxLabel: '' }
  return null
}

function normalizeQuestions(questions: FormQuestion[]) {
  return questions.map((question, index) => ({
    ...question,
    sortOrder: index,
    points: Number.isFinite(Number(question.points)) ? Math.max(0, Math.round(Number(question.points))) : 0,
    description: question.description?.trim() || null,
    options: defaultedOptions(question),
  }))
}

function defaultedOptions(question: FormQuestion): QuestionOptions | null {
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    const choices = (question.options?.choices ?? []).map((choice) => choice.trim()).filter(Boolean)
    const correct = (question.options?.correct ?? []).filter((choice) => choices.includes(choice))
    return { choices, correct }
  }
  if (question.type === 'SCALE') {
    const min = Number(question.options?.min ?? 1)
    const max = Number(question.options?.max ?? 5)
    return {
      min: Number.isFinite(min) ? Math.round(min) : 1,
      max: Number.isFinite(max) ? Math.max(Math.round(max), Math.round(min) + 1) : 5,
      minLabel: question.options?.minLabel?.trim() ?? '',
      maxLabel: question.options?.maxLabel?.trim() ?? '',
    }
  }
  return null
}

function testLink(shareToken: string) {
  if (typeof window === 'undefined') return `/form-tests/${shareToken}`
  return `${window.location.origin}/form-tests/${shareToken}`
}

function statusNext(status: FormTestStatus): FormTestStatus {
  if (status === 'ACTIVE') return 'DRAFT'
  if (status === 'ARCHIVED') return 'DRAFT'
  return 'ACTIVE'
}

export function FormTests({ module, title, description, canManage }: FormTestsProps) {
  const [showArchived, setShowArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM)
  const [draft, setDraft] = useState<FormTest | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const { addToast } = useToast()
  const { execute } = useApi()
  const { data: tests, loading, refetch } = useFetch<FormTest[]>(`/api/form-tests?module=${module}${showArchived ? '&archived=true' : ''}`)

  const selected = useMemo(() => tests?.find((test) => test.id === selectedId) ?? tests?.[0] ?? null, [selectedId, tests])
  const canEditQuestions = canManage && !!selected && selected._count.responses === 0

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  useEffect(() => {
    if (!selected) {
      setDraft(null)
      setDraftDirty(false)
      return
    }
    if (draftDirty && draft?.id === selected.id) return
    setDraft({
      ...selected,
      questions: selected.questions.map((question, index) => ({
        ...question,
        sortOrder: index,
        options: defaultedOptions(question),
      })),
    })
    setDraftDirty(false)
  }, [draft?.id, draftDirty, selected])

  const stats = useMemo(() => {
    const list = tests ?? []
    return {
      total: list.length,
      active: list.filter((test) => test.status === 'ACTIVE').length,
      responses: list.reduce((sum, test) => sum + test._count.responses, 0),
    }
  }, [tests])

  const createTest = async () => {
    const titleValue = createForm.title.trim()
    if (!titleValue) {
      addToast({ type: 'error', title: 'Titel fehlt' })
      return
    }
    setSaving(true)
    try {
      const created = await execute('/api/form-tests', {
        method: 'POST',
        body: JSON.stringify({
          module,
          kind: createForm.kind,
          title: titleValue,
          description: createForm.description,
          timeLimitMinutes: createForm.kind === 'TEST' && createForm.timeLimitMinutes.trim()
            ? Number(createForm.timeLimitMinutes)
            : null,
          anonymousResponses: createForm.kind === 'SURVEY' && createForm.anonymousResponses,
        }),
      }) as FormTest | null
      addToast({ type: 'success', title: createForm.kind === 'SURVEY' ? 'Umfrage erstellt' : 'Test erstellt' })
      setCreateOpen(false)
      setCreateForm(EMPTY_CREATE_FORM)
      await refetch()
      if (created?.id) setSelectedId(created.id)
    } catch (e) {
      addToast({ type: 'error', title: 'Test konnte nicht erstellt werden', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    const titleValue = draft.title.trim()
    if (!titleValue) {
      addToast({ type: 'error', title: 'Titel fehlt' })
      return
    }
    setSaving(true)
    try {
      await execute(`/api/form-tests/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: titleValue,
          description: draft.description,
          status: draft.status,
          kind: draft.kind,
          timeLimitMinutes: draft.kind === 'TEST' ? draft.timeLimitMinutes : null,
          anonymousResponses: draft.kind === 'SURVEY' && draft.anonymousResponses,
          ...(canEditQuestions ? { questions: normalizeQuestions(draft.questions) } : {}),
        }),
      })
      addToast({ type: 'success', title: 'Test gespeichert' })
      setDraftDirty(false)
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const deleteTest = async () => {
    if (!selected || !confirm(`Test "${selected.title}" wirklich löschen? Alle Abgaben werden mitgelöscht.`)) return
    setSaving(true)
    try {
      await execute(`/api/form-tests/${selected.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Test gelöscht' })
      setSelectedId(null)
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async () => {
    if (!selected) return
    const link = testLink(selected.shareToken)
    await navigator.clipboard.writeText(link)
    addToast({ type: 'success', title: 'Link kopiert' })
  }

  const selectTest = (id: string) => {
    if (draftDirty && selectedId && selectedId !== id && !confirm('Ungespeicherte Änderungen verwerfen?')) return
    setDraftDirty(false)
    setSelectedId(id)
  }

  const patchDraft = (patch: Partial<FormTest>) => {
    setDraftDirty(true)
    setDraft((current) => current ? { ...current, ...patch } : current)
  }

  const updateQuestion = (index: number, patch: Partial<FormQuestion>) => {
    setDraftDirty(true)
    setDraft((current) => {
      if (!current) return current
      const questions = current.questions.map((question, questionIndex) => {
        if (questionIndex !== index) return question
        const nextType = patch.type ?? question.type
        return {
          ...question,
          ...patch,
          options: patch.type && patch.type !== question.type ? defaultOptions(nextType) : (patch.options ?? question.options),
        }
      })
      return { ...current, questions }
    })
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setDraftDirty(true)
    setDraft((current) => {
      if (!current) return current
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.questions.length) return current
      const questions = [...current.questions]
      const [item] = questions.splice(index, 1)
      questions.splice(nextIndex, 0, item)
      return { ...current, questions }
    })
  }

  const removeQuestion = (index: number) => {
    setDraftDirty(true)
    setDraft((current) => current ? { ...current, questions: current.questions.filter((_, i) => i !== index) } : current)
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        action={canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {showArchived ? 'Archiv ausblenden' : 'Archiv zeigen'}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} />
              Formular erstellen
            </Button>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Formulare" value={stats.total} icon={<FileQuestion size={16} />} />
        <StatCard label="Aktive Links" value={stats.active} icon={<Link2 size={16} />} />
        <StatCard label="Abgaben" value={stats.responses} icon={<Clipboard size={16} />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[310px_1fr]">
        <aside className="glass-panel-elevated overflow-hidden rounded-[14px] border border-[#373737]/45">
          <div className="flex items-center justify-between border-b border-[#343434]/45 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a6a6a6]">Formularablage</p>
            <span className="text-[10.5px] text-[#686868]">{tests?.length ?? 0}</span>
          </div>
          <div className="max-h-[680px] overflow-y-auto p-1.5">
            {(tests ?? []).length === 0 ? (
              <div className="px-4 py-12 text-center">
                <FileQuestion size={24} className="mx-auto mb-2 text-[#808080]" />
                <p className="text-[12.5px] text-[#a6a6a6]">Noch keine Formulare vorhanden</p>
              </div>
            ) : (
              tests?.map((test) => (
                <button
                  key={test.id}
                  type="button"
                  onClick={() => selectTest(test.id)}
                  className={cn(
                    'w-full rounded-[9px] border px-3 py-2.5 text-left transition-colors',
                    selected?.id === test.id
                      ? 'border-[#d4d4d4]/30 bg-[#d4d4d4]/12'
                      : 'border-transparent hover:bg-[#232323]/60',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-[#d4d4d4]">{KIND_META[test.kind].icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-white">{test.title}</p>
                      <p className="mt-0.5 text-[11px] text-[#909090]">
                        {KIND_META[test.kind].label} · {test._count.questions} Fragen · {test._count.responses} Abgaben
                      </p>
                    </div>
                    <Badge variant={STATUS_META[test.status].variant}>{STATUS_META[test.status].label}</Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {!draft ? (
          <section className="glass-panel-elevated flex min-h-[520px] flex-col items-center justify-center rounded-[14px] border border-[#373737]/45 px-6 text-center">
            <FileQuestion size={34} className="mb-3 text-[#808080]" />
            <p className="text-[14px] font-semibold text-[#e5e5e5]">Kein Formular ausgewählt</p>
            <p className="mt-1 max-w-sm text-[12.5px] leading-5 text-[#a6a6a6]">
              Erstelle einen Test oder eine Umfrage und teile den Link mit eingeloggten Nutzern.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={KIND_META[draft.kind].variant}>{KIND_META[draft.kind].label}</Badge>
                  <Badge variant={STATUS_META[draft.status].variant}>{STATUS_META[draft.status].label}</Badge>
                  {draft.kind === 'TEST' && draft.timeLimitMinutes && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#404040]/60 bg-[#232323]/70 px-2 py-0.5 text-[11px] text-[#aeaeae]">
                      <Clock size={11} />
                      {draft.timeLimitMinutes} Min.
                    </span>
                  )}
                  {draft.kind === 'SURVEY' && draft.anonymousResponses && (
                    <span className="rounded-full border border-[#404040]/60 bg-[#232323]/70 px-2 py-0.5 text-[11px] text-[#aeaeae]">
                      Anonym
                    </span>
                  )}
                  <span className="text-[11.5px] text-[#909090]">Aktualisiert {formatDateTime(draft.updatedAt)}</span>
                  {selected && selected._count.responses > 0 && (
                    <span className="rounded-full border border-[#404040]/60 bg-[#232323]/70 px-2 py-0.5 text-[11px] text-[#aeaeae]">
                      Fragen gesperrt nach {selected._count.responses} Abgabe(n)
                    </span>
                  )}
                  {draftDirty && (
                    <span className="rounded-full border border-[#d4d4d4]/35 bg-[#d4d4d4]/10 px-2 py-0.5 text-[11px] font-medium text-[#d4d4d4]">
                      Ungespeichert
                    </span>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
                    <Button variant="secondary" size="sm" onClick={() => patchDraft({ status: statusNext(draft.status) })}>
                      {STATUS_META[draft.status].action}
                    </Button>
                    <Button variant="outline" size="sm" onClick={copyLink} disabled={draft.status !== 'ACTIVE'}>
                      <Copy size={13} />
                      Link
                    </Button>
                    <Link href={`/form-tests/${draft.shareToken}`} target="_blank">
                      <Button variant="outline" size="sm" type="button">
                        <ExternalLink size={13} />
                        Öffnen
                      </Button>
                    </Link>
                    <Link href={`/form-tests/manage/${draft.id}/responses`}>
                      <Button variant="outline" size="sm" type="button">
                        <Clipboard size={13} />
                        Abgaben
                      </Button>
                    </Link>
                    <Button size="sm" onClick={saveDraft} loading={saving}>
                      <Save size={13} />
                      Speichern
                    </Button>
                    <Button variant="danger" size="sm" onClick={deleteTest} loading={saving}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                <Input
                  label="Titel"
                  value={draft.title}
                  onChange={(event) => patchDraft({ title: event.target.value })}
                  disabled={!canManage}
                />
                <Select
                  label="Status"
                  value={draft.status}
                  onValueChange={(value) => patchDraft({ status: value as FormTestStatus })}
                  disabled={!canManage}
                  options={[
                    { value: 'DRAFT', label: 'Entwurf' },
                    { value: 'ACTIVE', label: 'Aktiv' },
                    { value: 'ARCHIVED', label: 'Archiv' },
                  ]}
                />
                <Select
                  label="Typ"
                  value={draft.kind}
                  onValueChange={(value) => {
                    const kind = value as FormTestKind
                    patchDraft({
                      kind,
                      timeLimitMinutes: kind === 'TEST' ? draft.timeLimitMinutes : null,
                      anonymousResponses: kind === 'SURVEY' ? draft.anonymousResponses : false,
                    })
                  }}
                  disabled={!canManage}
                  options={[
                    { value: 'TEST', label: 'Test' },
                    { value: 'SURVEY', label: 'Umfrage' },
                  ]}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {draft.kind === 'TEST' ? (
                  <Input
                    label="Zeitlimit in Minuten"
                    type="number"
                    min={1}
                    max={720}
                    value={draft.timeLimitMinutes ?? ''}
                    onChange={(event) => patchDraft({
                      timeLimitMinutes: event.target.value.trim() ? Number(event.target.value) : null,
                    })}
                    disabled={!canManage}
                    placeholder="Ohne Zeitlimit"
                  />
                ) : (
                  <div className="flex items-center rounded-[10px] border border-[#343434]/55 bg-[#181818]/45 px-3 py-2.5">
                    <Checkbox
                      checked={draft.anonymousResponses}
                      onCheckedChange={(checked) => patchDraft({ anonymousResponses: checked })}
                      label="Antworten anonym auswerten"
                      disabled={!canManage}
                    />
                  </div>
                )}
                <div className="flex items-center rounded-[10px] border border-[#343434]/55 bg-[#181818]/45 px-3 py-2.5 text-[12px] leading-5 text-[#a6a6a6]">
                  {draft.kind === 'TEST'
                    ? 'Bei Tests werden Kopieren, Drucken, Tabwechsel und andere Dashboard-Seiten während der aktiven Sitzung blockiert oder protokolliert.'
                    : 'Umfragen haben keine Zeitlimits und keine Test-Einschränkungen. Anonyme Umfragen zeigen in der Auswertung keinen Accountnamen.'}
                </div>
              </div>

              <Textarea
                label="Beschreibung"
                value={draft.description ?? ''}
                onChange={(event) => patchDraft({ description: event.target.value })}
                disabled={!canManage}
                rows={2}
                className="mt-3"
              />
            </div>

            <QuestionEditor
              questions={draft.questions}
              canEdit={canEditQuestions}
              isSurvey={draft.kind === 'SURVEY'}
              onAdd={() => patchDraft({ questions: [...draft.questions, createEmptyQuestion()] })}
              onChange={updateQuestion}
              onMove={moveQuestion}
              onRemove={removeQuestion}
            />
          </section>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Formular erstellen">
        <div className="space-y-4">
          <Input
            label="Titel"
            value={createForm.title}
            onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
            placeholder="z. B. Bewerbungsgespräch Theorie"
            required
          />
          <Select
            label="Typ"
            value={createForm.kind}
            onValueChange={(value) => {
              const kind = value as FormTestKind
              setCreateForm({
                ...createForm,
                kind,
                timeLimitMinutes: kind === 'TEST' ? createForm.timeLimitMinutes : '',
                anonymousResponses: kind === 'SURVEY' ? createForm.anonymousResponses : false,
              })
            }}
            options={[
              { value: 'TEST', label: 'Test' },
              { value: 'SURVEY', label: 'Umfrage' },
            ]}
          />
          {createForm.kind === 'TEST' ? (
            <Input
              label="Zeitlimit in Minuten"
              type="number"
              min={1}
              max={720}
              value={createForm.timeLimitMinutes}
              onChange={(event) => setCreateForm({ ...createForm, timeLimitMinutes: event.target.value })}
              placeholder="Ohne Zeitlimit"
            />
          ) : (
            <div className="rounded-[10px] border border-[#343434]/55 bg-[#181818]/45 px-3 py-2.5">
              <Checkbox
                checked={createForm.anonymousResponses}
                onCheckedChange={(checked) => setCreateForm({ ...createForm, anonymousResponses: checked })}
                label="Antworten anonym auswerten"
              />
            </div>
          )}
          <Textarea
            label="Beschreibung"
            value={createForm.description}
            onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={createTest} loading={saving} disabled={!createForm.title.trim()}>
              Erstellen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="glass-panel-elevated flex items-center gap-3 rounded-[12px] border border-white/[0.04] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#d4d4d4]/15 text-[#d4d4d4]">{icon}</div>
      <div>
        <p className="text-[20px] font-semibold leading-tight text-white tabular-nums">{value}</p>
        <p className="mt-0.5 text-[11px] text-[#a6a6a6]">{label}</p>
      </div>
    </div>
  )
}

function QuestionEditor({
  questions,
  canEdit,
  isSurvey,
  onAdd,
  onChange,
  onMove,
  onRemove,
}: {
  questions: FormQuestion[]
  canEdit: boolean
  isSurvey: boolean
  onAdd: () => void
  onChange: (index: number, patch: Partial<FormQuestion>) => void
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#808080]">Fragen</p>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Plus size={13} />
            Frage
          </Button>
        )}
      </div>

      {questions.length === 0 ? (
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 py-12 text-center">
          <FileQuestion size={24} className="mx-auto mb-2 text-[#808080]" />
          <p className="text-[12.5px] text-[#a6a6a6]">Noch keine Fragen angelegt</p>
        </div>
      ) : (
        questions.map((question, index) => (
          <div key={question.id ?? index} className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
            <div className="mb-3 flex items-center gap-2">
              <GripVertical size={14} className="text-[#808080]" />
              <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-[#232323] text-[11px] font-semibold text-[#d4d4d4]">
                {index + 1}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button type="button" disabled={!canEdit || index === 0} onClick={() => onMove(index, -1)} className="rounded-[7px] p-1.5 text-[#909090] hover:bg-[#232323] hover:text-[#d4d4d4] disabled:opacity-30">
                  <MoveUp size={13} />
                </button>
                <button type="button" disabled={!canEdit || index === questions.length - 1} onClick={() => onMove(index, 1)} className="rounded-[7px] p-1.5 text-[#909090] hover:bg-[#232323] hover:text-[#d4d4d4] disabled:opacity-30">
                  <MoveDown size={13} />
                </button>
                <button type="button" disabled={!canEdit} onClick={() => onRemove(index)} className="rounded-[7px] p-1.5 text-[#909090] hover:bg-[#321218]/40 hover:text-red-400 disabled:opacity-30">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            <div className={cn('grid grid-cols-1 gap-3', isSurvey ? 'lg:grid-cols-[1fr_190px]' : 'lg:grid-cols-[1fr_190px_110px]')}>
              <Input
                label="Frage"
                value={question.title}
                onChange={(event) => onChange(index, { title: event.target.value })}
                disabled={!canEdit}
                placeholder="Fragetext"
              />
              <Select
                label="Typ"
                value={question.type}
                onValueChange={(value) => onChange(index, { type: value as QuestionType })}
                options={QUESTION_TYPE_OPTIONS}
                disabled={!canEdit}
              />
              {!isSurvey && (
                <Input
                  label="Punkte"
                  type="number"
                  min={0}
                  value={question.points}
                  onChange={(event) => onChange(index, { points: Number(event.target.value) })}
                  disabled={!canEdit}
                />
              )}
            </div>

            <Textarea
              label="Hilfetext"
              value={question.description ?? ''}
              onChange={(event) => onChange(index, { description: event.target.value })}
              disabled={!canEdit}
              rows={2}
              className="mt-3"
            />

            <div className="mt-3">
              <Checkbox
                checked={question.required}
                onCheckedChange={(checked) => onChange(index, { required: checked })}
                label="Pflichtfrage"
                disabled={!canEdit}
              />
            </div>

            {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') && (
              <ChoiceOptions
                question={question}
                disabled={!canEdit}
                showCorrect={!isSurvey}
                onChange={(options) => onChange(index, { options })}
              />
            )}
            {question.type === 'SCALE' && (
              <ScaleOptions question={question} disabled={!canEdit} onChange={(options) => onChange(index, { options })} />
            )}
          </div>
        ))
      )}
    </div>
  )
}

function ChoiceOptions({
  question,
  disabled,
  showCorrect,
  onChange,
}: {
  question: FormQuestion
  disabled: boolean
  showCorrect: boolean
  onChange: (options: QuestionOptions) => void
}) {
  const choices = question.options?.choices ?? []
  const correct = question.options?.correct ?? []

  const setChoice = (choiceIndex: number, value: string) => {
    const nextChoices = choices.map((choice, index) => index === choiceIndex ? value : choice)
    onChange({ choices: nextChoices, correct: showCorrect ? correct.filter((choice) => nextChoices.includes(choice)) : [] })
  }

  const toggleCorrect = (choice: string) => {
    if (!choice.trim()) return
    if (question.type === 'SINGLE_CHOICE') {
      onChange({ choices, correct: correct[0] === choice ? [] : [choice] })
      return
    }
    onChange({
      choices,
      correct: correct.includes(choice) ? correct.filter((item) => item !== choice) : [...correct, choice],
    })
  }

  return (
    <div className="mt-4 rounded-[12px] border border-[#343434]/45 bg-[#181818]/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-semibold text-[#aeaeae]">Antwortoptionen</p>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange({ choices: [...choices, `Option ${choices.length + 1}`], correct: showCorrect ? correct : [] })}
        >
          <Plus size={12} />
          Option
        </Button>
      </div>
      <div className="space-y-2">
        {choices.map((choice, index) => (
          <div key={index} className="flex items-center gap-2">
            {showCorrect && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleCorrect(choice)}
                className={cn(
                  'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] border text-[11px] font-semibold transition-colors',
                  correct.includes(choice)
                    ? 'border-[#34d399]/50 bg-[#123026] text-[#86efac]'
                    : 'border-[#404040]/70 bg-[#181818] text-[#909090] hover:text-[#d4d4d4]',
                )}
                title="Als richtige Antwort markieren"
              >
                <CheckCircle2 size={14} />
              </button>
            )}
            <Input
              value={choice}
              onChange={(event) => setChoice(index, event.target.value)}
              disabled={disabled}
              className="h-[34px]"
            />
            <button
              type="button"
              disabled={disabled || choices.length <= 2}
              onClick={() => {
                const nextChoices = choices.filter((_, choiceIndex) => choiceIndex !== index)
                onChange({ choices: nextChoices, correct: showCorrect ? correct.filter((item) => nextChoices.includes(item)) : [] })
              }}
              className="rounded-[8px] p-2 text-[#909090] hover:bg-[#321218]/40 hover:text-red-400 disabled:opacity-30"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ScaleOptions({ question, disabled, onChange }: { question: FormQuestion; disabled: boolean; onChange: (options: QuestionOptions) => void }) {
  const options = question.options ?? { min: 1, max: 5, minLabel: '', maxLabel: '' }
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 rounded-[12px] border border-[#343434]/45 bg-[#181818]/50 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input label="Minimum" type="number" value={options.min ?? 1} disabled={disabled} onChange={(event) => onChange({ ...options, min: Number(event.target.value) })} />
      <Input label="Maximum" type="number" value={options.max ?? 5} disabled={disabled} onChange={(event) => onChange({ ...options, max: Number(event.target.value) })} />
      <Input label="Label Minimum" value={options.minLabel ?? ''} disabled={disabled} onChange={(event) => onChange({ ...options, minLabel: event.target.value })} />
      <Input label="Label Maximum" value={options.maxLabel ?? ''} disabled={disabled} onChange={(event) => onChange({ ...options, maxLabel: event.target.value })} />
    </div>
  )
}
