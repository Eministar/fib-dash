'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ClipboardList, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  APPLICATION_QUESTION_TYPES,
  DEFAULT_APPLICATION_FORM_CONFIG,
  type ApplicationAutoFillValue,
  type ApplicationFormConfig,
  type ApplicationQuestion,
  type ApplicationQuestionOptions,
  type ApplicationQuestionType,
} from '@/lib/job-applications'

interface ApplicationFormSettingsProps {
  canManage: boolean
}

const QUESTION_TYPE_LABELS: Record<ApplicationQuestionType, string> = {
  SHORT_TEXT: 'Kurztext',
  LONG_TEXT: 'Langtext',
  SINGLE_CHOICE: 'Einzelauswahl',
  MULTIPLE_CHOICE: 'Mehrfachauswahl',
  SCALE: 'Skala',
}

const questionTypeOptions = APPLICATION_QUESTION_TYPES.map((type) => ({
  value: type,
  label: QUESTION_TYPE_LABELS[type],
}))

const autoFillOptions = [
  { value: '', label: 'Keine Automatik' },
  { value: 'DISCORD_ID', label: 'Discord-ID' },
]

function cloneQuestion(question: ApplicationQuestion): ApplicationQuestion {
  return {
    ...question,
    options: question.options
      ? {
          ...question.options,
          choices: question.options.choices ? [...question.options.choices] : undefined,
        }
      : null,
  }
}

function cloneConfig(config: ApplicationFormConfig): ApplicationFormConfig {
  return {
    title: config.title,
    questions: config.questions.map(cloneQuestion),
  }
}

function reindexQuestions(questions: ApplicationQuestion[]) {
  return questions.map((question, index) => ({ ...question, sortOrder: index }))
}

function stripEmptyOptions(options: ApplicationQuestionOptions) {
  const cleanEntries = Object.entries(options).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  })

  return cleanEntries.length
    ? (Object.fromEntries(cleanEntries) as ApplicationQuestionOptions)
    : null
}

function defaultOptionsForType(type: ApplicationQuestionType): ApplicationQuestionOptions | null {
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
    return { choices: ['Ja', 'Nein'] }
  }

  if (type === 'SCALE') {
    return { min: 1, max: 10 }
  }

  return null
}

function createQuestion(index: number, section?: string | null): ApplicationQuestion {
  return {
    id: `frage_${Date.now()}_${index + 1}`,
    type: 'LONG_TEXT',
    section: section || null,
    title: 'Neue Frage',
    description: null,
    required: true,
    options: null,
    sortOrder: index,
  }
}

function normalizeChoices(value: string) {
  return value
    .split('\n')
    .map((choice) => choice.trim())
    .filter(Boolean)
}

export function ApplicationFormSettings({ canManage }: ApplicationFormSettingsProps) {
  const { data, loading, error, refetch } = useFetch<ApplicationFormConfig>('/api/applications/config')
  const { execute } = useApi<ApplicationFormConfig>()
  const { addToast } = useToast()
  const [draft, setDraft] = useState<ApplicationFormConfig>(() => cloneConfig(DEFAULT_APPLICATION_FORM_CONFIG))
  const [saving, setSaving] = useState(false)
  // Sobald der Nutzer editiert, darf der Live-Refetch (useFetch aktualisiert `data`
  // alle paar Sekunden im Hintergrund) den Draft NICHT mehr überschreiben — sonst
  // gehen ungespeicherte Eingaben verloren.
  const [dirty, setDirty] = useState(false)

  const editDraft: typeof setDraft = (value) => {
    setDirty(true)
    setDraft(value)
  }

  useEffect(() => {
    if (data && !dirty) setDraft(cloneConfig(data))
  }, [data, dirty])

  const requiredCount = useMemo(
    () => draft.questions.filter((question) => question.required).length,
    [draft.questions],
  )

  const updateQuestion = (index: number, patch: Partial<ApplicationQuestion>) => {
    editDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    }))
  }

  const updateQuestionOptions = (index: number, patch: ApplicationQuestionOptions) => {
    editDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => {
        if (questionIndex !== index) return question
        const options = stripEmptyOptions({ ...(question.options ?? {}), ...patch })
        return { ...question, options }
      }),
    }))
  }

  const changeQuestionType = (index: number, type: ApplicationQuestionType) => {
    editDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => {
        if (questionIndex !== index) return question

        const preservedAuto =
          type === 'SHORT_TEXT' && question.options?.autoFill
            ? {
                autoFill: question.options.autoFill,
                readOnly: true,
              }
            : {}

        return {
          ...question,
          type,
          options: stripEmptyOptions({
            ...(defaultOptionsForType(type) ?? {}),
            ...preservedAuto,
          }),
        }
      }),
    }))
  }

  const addQuestion = () => {
    editDraft((current) => {
      const previousSection = current.questions[current.questions.length - 1]?.section ?? null
      return {
        ...current,
        questions: reindexQuestions([
          ...current.questions,
          createQuestion(current.questions.length, previousSection),
        ]),
      }
    })
  }

  const removeQuestion = (index: number) => {
    editDraft((current) => ({
      ...current,
      questions: reindexQuestions(current.questions.filter((_, questionIndex) => questionIndex !== index)),
    }))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    editDraft((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.questions.length) return current

      const questions = [...current.questions]
      const [question] = questions.splice(index, 1)
      questions.splice(nextIndex, 0, question)

      return {
        ...current,
        questions: reindexQuestions(questions),
      }
    })
  }

  const loadDefaults = () => {
    editDraft(cloneConfig(DEFAULT_APPLICATION_FORM_CONFIG))
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await execute('/api/applications/config', {
        method: 'PUT',
        body: JSON.stringify(draft),
      })
      if (saved) setDraft(cloneConfig(saved))
      // Gespeichert → Draft entspricht wieder dem Server-Stand, Live-Refetch darf
      // wieder seeden.
      setDirty(false)
      addToast({ type: 'success', title: 'Bewerbungsformular gespeichert' })
      await refetch()
    } catch (e) {
      addToast({
        type: 'error',
        title: 'Speichern fehlgeschlagen',
        message: e instanceof Error ? e.message : '',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bewerbungsformular"
        description="Fragen, Pflichtfelder und automatische Bewerberdaten für das öffentliche Bewerberportal verwalten."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={loadDefaults} disabled={!canManage || saving}>
              <RotateCcw size={13} />
              Standard laden
            </Button>
            <Button type="button" size="sm" onClick={save} loading={saving} disabled={!canManage}>
              <Save size={13} />
              Speichern
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-[12px] border border-[#3b1616] bg-[#1c1111] px-4 py-3 text-[12.5px] text-[#fca5a5]">
          {error}
        </div>
      )}

      <section className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_160px]">
          <Input
            label="Formulartitel"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            disabled={!canManage || saving}
          />
          <SummaryTile label="Fragen" value={draft.questions.length} />
          <SummaryTile label="Pflichtfelder" value={requiredCount} />
        </div>
      </section>

      <section className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70">
        <div className="flex flex-col gap-3 border-b border-[#343434]/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-[#d4d4d4]" />
            <h2 className="text-[14px] font-semibold text-white">Fragen</h2>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addQuestion} disabled={!canManage || saving}>
            <Plus size={13} />
            Frage hinzufügen
          </Button>
        </div>

        <div className="space-y-3 p-3">
          {draft.questions.map((question, index) => (
            <QuestionEditor
              key={`${question.id}-${index}`}
              canManage={canManage}
              disabled={saving}
              question={question}
              index={index}
              total={draft.questions.length}
              onChange={(patch) => updateQuestion(index, patch)}
              onOptionsChange={(patch) => updateQuestionOptions(index, patch)}
              onTypeChange={(type) => changeQuestionType(index, type)}
              onMove={(direction) => moveQuestion(index, direction)}
              onRemove={() => removeQuestion(index)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-white/[0.04] bg-[#181818]/65 px-4 py-3">
      <p className="text-[20px] font-semibold leading-tight text-white tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-[#a6a6a6]">{label}</p>
    </div>
  )
}

function QuestionEditor({
  canManage,
  disabled,
  question,
  index,
  total,
  onChange,
  onOptionsChange,
  onTypeChange,
  onMove,
  onRemove,
}: {
  canManage: boolean
  disabled: boolean
  question: ApplicationQuestion
  index: number
  total: number
  onChange: (patch: Partial<ApplicationQuestion>) => void
  onOptionsChange: (patch: ApplicationQuestionOptions) => void
  onTypeChange: (type: ApplicationQuestionType) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const locked = !canManage || disabled
  const hasChoices = question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE'
  const hasScale = question.type === 'SCALE'

  return (
    <article className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/55 p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#232323] text-[11.5px] font-semibold text-[#d4d4d4]">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-white">{question.title || 'Unbenannte Frage'}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="info">{QUESTION_TYPE_LABELS[question.type]}</Badge>
              {question.required && <Badge variant="warning">Pflicht</Badge>}
              {question.options?.autoFill && <Badge variant="success">Automatisch</Badge>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton label="Nach oben" disabled={locked || index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="Nach unten" disabled={locked || index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton label="Entfernen" disabled={locked || total <= 1} danger onClick={onRemove}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px]">
        <Input
          label="Frage"
          value={question.title}
          onChange={(event) => onChange({ title: event.target.value })}
          disabled={locked}
        />
        <Select
          label="Typ"
          value={question.type}
          onValueChange={(value) => onTypeChange(value as ApplicationQuestionType)}
          options={questionTypeOptions}
          disabled={locked}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px]">
        <Input
          label="Abschnitt"
          value={question.section ?? ''}
          onChange={(event) => onChange({ section: event.target.value })}
          disabled={locked}
          placeholder="z. B. Allgemeine Informationen"
        />
        <Select
          label="Automatisch ausfüllen"
          value={question.options?.autoFill ?? ''}
          onValueChange={(value) =>
            onOptionsChange({
              autoFill: value ? (value as ApplicationAutoFillValue) : undefined,
              readOnly: value ? true : undefined,
            })
          }
          options={autoFillOptions}
          disabled={locked || question.type !== 'SHORT_TEXT'}
        />
      </div>

      <Textarea
        label="Beschreibung"
        value={question.description ?? ''}
        onChange={(event) => onChange({ description: event.target.value })}
        rows={2}
        className="mt-3"
        disabled={locked}
      />

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Checkbox
          checked={question.required}
          onCheckedChange={(checked) => onChange({ required: checked })}
          label="Pflichtfrage"
          disabled={locked}
        />
        <Checkbox
          checked={Boolean(question.options?.readOnly)}
          onCheckedChange={(checked) => onOptionsChange({ readOnly: checked || question.options?.autoFill ? true : undefined })}
          label="Schreibgeschützt"
          disabled={locked || Boolean(question.options?.autoFill)}
        />
      </div>

      {hasChoices && (
        <Textarea
          label="Antwortoptionen"
          value={question.options?.choices?.join('\n') ?? ''}
          onChange={(event) => onOptionsChange({ choices: normalizeChoices(event.target.value) })}
          rows={4}
          className="mt-3"
          disabled={locked}
          placeholder={'Ja\nNein'}
        />
      )}

      {hasScale && (
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Input
            label="Minimum"
            type="number"
            value={question.options?.min ?? 1}
            onChange={(event) => onOptionsChange({ min: Number(event.target.value) })}
            disabled={locked}
          />
          <Input
            label="Maximum"
            type="number"
            value={question.options?.max ?? 10}
            onChange={(event) => onOptionsChange({ max: Number(event.target.value) })}
            disabled={locked}
          />
          <Input
            label="Min-Label"
            value={question.options?.minLabel ?? ''}
            onChange={(event) => onOptionsChange({ minLabel: event.target.value })}
            disabled={locked}
          />
          <Input
            label="Max-Label"
            value={question.options?.maxLabel ?? ''}
            onChange={(event) => onOptionsChange({ maxLabel: event.target.value })}
            disabled={locked}
          />
        </div>
      )}
    </article>
  )
}

function IconButton({
  label,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-[8px] border transition-colors',
        danger
          ? 'border-[#4a1a2a]/50 text-[#fca5a5] hover:bg-[#2a1620]/70'
          : 'border-[#343434]/60 text-[#c3c3c3] hover:border-[#404040] hover:bg-[#232323]/70',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}
