'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { BadgeCheck, CheckCircle2, ClipboardList, LogOut, MessageCircle, Send, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { PageLoader } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import {
  DEFAULT_APPLICATION_FORM_TITLE,
  JOB_APPLICATION_STATUS_META,
  applicationAnswerText,
  type ApplicationQuestion,
  type JobApplicationStatusValue,
} from '@/lib/job-applications'

interface PortalApplicationAnswer {
  id: string
  questionId: string
  questionTitle: string
  questionType: string
  value: Record<string, unknown>
  sortOrder: number
}

interface PortalApplication {
  id: string
  caseNumber: string | null
  status: JobApplicationStatusValue
  statusText: string
  submittedAt: string
  updatedAt: string
  reviewedAt: string | null
  answers: PortalApplicationAnswer[]
}

interface PortalPayload {
  user: {
    id: string
    username: string
    displayName: string
    discordId: string | null
    avatarUrl: string | null
  }
  formTitle: string
  questions: ApplicationQuestion[]
  application: PortalApplication | null
}

function startDiscordLogin() {
  window.location.href = '/api/auth/discord/login?mode=application&remember=1'
}

export default function ApplicationPortalPage() {
  const { user, loading: authLoading, refreshUser } = useAuth()
  const { execute } = useApi()
  const { addToast } = useToast()
  const { data, loading, error, refetch } = useFetch<PortalPayload>(!authLoading && user ? '/api/applications/me' : null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [formOpen, setFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setLoginError(params.get('error') ?? '')
  }, [])

  const questions = useMemo(() => data?.questions ?? [], [data?.questions])
  const formTitle = data?.formTitle ?? DEFAULT_APPLICATION_FORM_TITLE
  const application = data?.application ?? null

  useEffect(() => {
    if (!data?.user || questions.length === 0) return

    setAnswers((current) => {
      let changed = false
      const next = { ...current }

      questions.forEach((question) => {
        if (question.options?.autoFill === 'DISCORD_ID' && next[question.id] !== data.user.discordId) {
          next[question.id] = data.user.discordId ?? ''
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [data?.user, questions])

  const answeredRequired = useMemo(() => {
    if (questions.length === 0) return false
    return questions.every((question) => {
      if (!question.required) return true
      const value = answers[question.id]
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  }, [answers, questions])

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [questionId]: value }))
  }

  const logout = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' }).catch(() => undefined)
    await refreshUser().catch(() => undefined)
    window.location.href = '/bewerbung'
  }

  const submitApplication = async () => {
    setSubmitting(true)
    try {
      await execute('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ answers }),
      })
      addToast({ type: 'success', title: 'Bewerbung eingereicht' })
      setFormOpen(false)
      setAnswers({})
      // Der Anzeigename trägt jetzt das Aktenzeichen — ohne refreshUser zeigt
      // die Kopfzeile weiter den alten Namen.
      await Promise.all([refetch(), refreshUser().catch(() => undefined)])
    } catch (e) {
      addToast({ type: 'error', title: 'Bewerbung konnte nicht gespeichert werden', message: e instanceof Error ? e.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <PageLoader />

  return (
    <main className="min-h-screen bg-[#080808] bg-pattern text-[#f4f4f4]">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-[#343434]/55 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[13px] border border-[#d4d4d4]/25 bg-[#1e1e1e]">
              <Image src="/shield.webp" alt="FIB" width={40} height={40} priority className="rounded-full" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight text-white">FIB Bewerberportal</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d4d4d4]/75">
                Discord Anmeldung
              </p>
            </div>
          </div>
          {user && (
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#404040] px-3 text-[12.5px] font-medium text-[#e5e5e5] transition-colors hover:bg-[#232323]/60"
            >
              <LogOut size={14} />
              Abmelden
            </button>
          )}
        </header>

        <div className="flex flex-1 items-center py-8">
          {!user ? (
            <section className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 lg:grid-cols-[1fr_360px] lg:items-center">
              <div className="min-w-0">
                <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]/80">Bewerbung</p>
                <h1 className="max-w-2xl text-[28px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[34px]">
                  Melde dich mit Discord an und reiche deine Bewerbung ein.
                </h1>
                <p className="mt-4 max-w-xl text-[13.5px] leading-6 text-[#aeaeae]">
                  Dieses Portal zeigt nur deine eigene Bewerbung und den aktuellen Status. Interne HR-Inhalte bleiben außerhalb dieses Bereichs.
                </p>
              </div>

              <div className="rounded-[16px] border border-[#373737]/55 bg-[#1b1b1b]/75 p-5 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
                <div className="mb-5 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#5865f2]/15 text-[#9aa8ff]">
                    <MessageCircle size={18} />
                  </div>
                  <div>
                    <h2 className="text-[14px] font-semibold text-white">Discord-Konto verbinden</h2>
                    <p className="mt-1 text-[12.5px] leading-5 text-[#a6a6a6]">
                      Zugriff erhältst du mit der konfigurierten Bewerberrolle.
                    </p>
                  </div>
                </div>
                {loginError && (
                  <div className="mb-4 rounded-[10px] border border-[#3b1616] bg-[#1c1111] px-3 py-2 text-[12px] text-[#fca5a5]">
                    {loginError}
                  </div>
                )}
                <Button type="button" className="h-[42px] w-full" onClick={startDiscordLogin}>
                  <ShieldCheck size={15} />
                  Mit Discord anmelden
                </Button>
              </div>
            </section>
          ) : loading ? (
            <PageLoader />
          ) : error || !data ? (
            <section className="mx-auto w-full max-w-xl rounded-[16px] border border-[#3b1616]/70 bg-[#1c1111]/75 p-6 text-center">
              <ClipboardList size={28} className="mx-auto mb-3 text-[#fca5a5]" />
              <h1 className="text-[17px] font-semibold text-white">Bewerberportal nicht verfügbar</h1>
              <p className="mt-2 text-[13px] leading-5 text-[#f3b7b7]">{error ?? 'Die Daten konnten nicht geladen werden.'}</p>
            </section>
          ) : application ? (
            <ApplicationStatusView application={application} user={data.user} />
          ) : formOpen ? (
            <ApplicationForm
              formTitle={formTitle}
              questions={questions}
              answers={answers}
              submitting={submitting}
              answeredRequired={answeredRequired}
              onAnswer={setAnswer}
              onBack={() => setFormOpen(false)}
              onSubmit={submitApplication}
            />
          ) : (
            <ApplicationOpenView formTitle={formTitle} user={data.user} onOpen={() => setFormOpen(true)} />
          )}
        </div>
      </div>
    </main>
  )
}

function ApplicationOpenView({
  formTitle,
  user,
  onOpen,
}: {
  formTitle: string
  user: PortalPayload['user']
  onOpen: () => void
}) {
  return (
    <section className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-5 lg:grid-cols-[1fr_340px] lg:items-center">
      <div>
        <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]/80">{formTitle}</p>
        <h1 className="max-w-2xl text-[27px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[32px]">
          Bewerbung öffnen für {user.displayName}
        </h1>
        <p className="mt-4 max-w-xl text-[13.5px] leading-6 text-[#aeaeae]">
          Du beantwortest die Fragen einmal. Danach siehst du hier live den Status deiner Bewerbung.
        </p>
        <Button type="button" size="lg" className="mt-6" onClick={onOpen}>
          <ClipboardList size={16} />
          Bewerbung öffnen
        </Button>
      </div>

      <AccountPanel user={user} />
    </section>
  )
}

function AccountPanel({ user }: { user: PortalPayload['user'] }) {
  return (
    <aside className="rounded-[16px] border border-[#373737]/55 bg-[#1b1b1b]/75 p-5 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-3">
        {user.avatarUrl ? (
          <span
            className="h-12 w-12 shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/25"
            style={{ backgroundImage: `url(${user.avatarUrl})` }}
            aria-label={user.displayName}
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#d4d4d4] text-[15px] font-bold text-[#181818]">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-white">{user.displayName}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-[#909090]">
            {user.discordId ? `Discord-ID ${user.discordId}` : user.username}
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-[12px] border border-[#343434]/55 bg-[#181818]/60 p-3">
        <div className="flex items-start gap-2">
          <UserRound size={15} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
          <p className="text-[12.5px] leading-5 text-[#aeaeae]">
            Dein Discord-Account wird nur zur Zuordnung deiner Bewerbung genutzt.
          </p>
        </div>
      </div>
    </aside>
  )
}

function ApplicationStatusView({ application, user }: { application: PortalApplication; user: PortalPayload['user'] }) {
  const meta = JOB_APPLICATION_STATUS_META[application.status]

  return (
    <section className="mx-auto w-full max-w-4xl space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-[16px] border border-[#373737]/55 bg-[#1b1b1b]/75 p-6 shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <span className="text-[12px] text-[#909090]">Aktualisiert {formatDateTime(application.updatedAt)}</span>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[#123026] text-[#86efac]">
              <CheckCircle2 size={25} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold leading-tight text-white">Deine Bewerbung ist eingereicht</h1>
              <p className="mt-2 text-[14px] leading-6 text-[#e5e5e5]">{application.statusText}</p>
              {application.caseNumber && (
                <div className="mt-4 rounded-[12px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/10 px-4 py-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#d4d4d4]/80">
                    Dein Aktenzeichen
                  </p>
                  <p className="mt-1 font-mono text-[20px] font-semibold tracking-wide text-[#d4d4d4]">
                    {application.caseNumber}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-5 text-[#c6c6c6]">
                    Nenne dieses Aktenzeichen bei jeder Rückfrage. Dein Name wurde dafür auf
                    „{application.caseNumber} | Vorname Nachname“ umgestellt.
                  </p>
                </div>
              )}
              <p className="mt-3 text-[12.5px] text-[#a6a6a6]">Eingereicht {formatDateTime(application.submittedAt)}</p>
            </div>
          </div>
        </div>
        <AccountPanel user={user} />
      </div>

      <section className="rounded-[16px] border border-[#373737]/55 bg-[#1b1b1b]/75 p-5">
        <div className="mb-3 flex items-center gap-2">
          <BadgeCheck size={16} className="text-[#d4d4d4]" />
          <h2 className="text-[14px] font-semibold text-white">Deine Antworten</h2>
        </div>
        <div className="space-y-3">
          {application.answers.map((answer, index) => (
            <div key={answer.id} className="rounded-[12px] border border-[#343434]/50 bg-[#181818]/55 p-3">
              <div className="mb-1.5 flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#232323] text-[10px] font-semibold text-[#d4d4d4]">
                  {index + 1}
                </span>
                <p className="text-[12.5px] font-semibold text-white">{answer.questionTitle}</p>
              </div>
              <p className="whitespace-pre-wrap pl-7 text-[12.5px] leading-5 text-[#d3d3d3]">{applicationAnswerText(answer)}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}

function ApplicationForm({
  formTitle,
  questions,
  answers,
  submitting,
  answeredRequired,
  onAnswer,
  onBack,
  onSubmit,
}: {
  formTitle: string
  questions: ApplicationQuestion[]
  answers: Record<string, unknown>
  submitting: boolean
  answeredRequired: boolean
  onAnswer: (questionId: string, value: unknown) => void
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]/80">{formTitle}</p>
          <h1 className="text-[22px] font-semibold text-white">Fragen beantworten</h1>
          <p className="mt-1 text-[13px] leading-5 text-[#a6a6a6]">Fülle alle Pflichtfragen aus und sende deine Bewerbung ab.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onBack} disabled={submitting}>
          Zurück
        </Button>
      </div>

      <div className="space-y-4">
        {questions.map((question, index) => (
          <Fragment key={question.id}>
            {question.section && question.section !== questions[index - 1]?.section && (
              <div className="pt-2">
                <p className="border-b border-[#373737]/55 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d4d4d4]/85">
                  {question.section}
                </p>
              </div>
            )}
            <QuestionField
              index={index}
              question={question}
              value={answers[question.id]}
              onChange={(value) => onAnswer(question.id, value)}
            />
          </Fragment>
        ))}
      </div>

      <div className="sticky bottom-0 mt-5 rounded-[14px] border border-[#373737]/55 bg-[#080808]/90 p-3 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[12.5px] text-[#a6a6a6]">
            <ClipboardList size={15} className="text-[#d4d4d4]" />
            {questions.length} Frage(n)
          </div>
          <Button type="button" onClick={onSubmit} loading={submitting} disabled={!answeredRequired}>
            <Send size={14} />
            Bewerbung absenden
          </Button>
        </div>
      </div>
    </section>
  )
}

function QuestionField({
  index,
  question,
  value,
  onChange,
}: {
  index: number
  question: ApplicationQuestion
  value: unknown
  onChange: (value: unknown) => void
}) {
  return (
    <section className="rounded-[14px] border border-[#373737]/55 bg-[#1b1b1b]/75 p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#232323] text-[11.5px] font-semibold text-[#d4d4d4]">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-white">{question.title}</h2>
            {question.required && <Badge variant="warning">Pflicht</Badge>}
          </div>
          {question.description && <p className="mt-1 text-[12.5px] leading-5 text-[#a6a6a6]">{question.description}</p>}
        </div>
      </div>
      <QuestionInput question={question} value={value} onChange={onChange} />
    </section>
  )
}

function QuestionInput({ question, value, onChange }: { question: ApplicationQuestion; value: unknown; onChange: (value: unknown) => void }) {
  const readOnly = Boolean(question.options?.readOnly || question.options?.autoFill)

  if (question.type === 'SHORT_TEXT') {
    return (
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={readOnly}
        className={cn(
          'h-[38px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 text-[13.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]',
          readOnly && 'cursor-not-allowed border-[#343434]/45 bg-[#181818]/70 text-[#a6a6a6]',
        )}
        placeholder={readOnly ? 'Wird automatisch ermittelt' : 'Antwort eingeben'}
      />
    )
  }

  if (question.type === 'LONG_TEXT') {
    return (
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="w-full resize-none rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 py-2.5 text-[13.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
        placeholder="Antwort eingeben"
      />
    )
  }

  if (question.type === 'SINGLE_CHOICE') {
    const selected = typeof value === 'string' ? value : ''
    return (
      <div className="space-y-2">
        {(question.options?.choices ?? []).map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => onChange(choice)}
            className={cn(
              'flex w-full items-center gap-2 rounded-[10px] border px-3 py-2.5 text-left text-[13px] transition-colors',
              selected === choice
                ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/12 text-white'
                : 'border-[#343434]/60 bg-[#181818]/45 text-[#e5e5e5] hover:border-[#404040]',
            )}
          >
            <span className={cn('h-3.5 w-3.5 rounded-full border', selected === choice ? 'border-[#d4d4d4] bg-[#d4d4d4]' : 'border-[#808080]')} />
            {choice}
          </button>
        ))}
      </div>
    )
  }

  if (question.type === 'MULTIPLE_CHOICE') {
    const selected = Array.isArray(value) ? value.map(String) : []
    const toggle = (choice: string) => {
      onChange(selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected, choice])
    }
    return (
      <div className="space-y-2">
        {(question.options?.choices ?? []).map((choice) => (
          <Checkbox
            key={choice}
            checked={selected.includes(choice)}
            onCheckedChange={() => toggle(choice)}
            label={choice}
            className="rounded-[10px] border border-[#343434]/60 bg-[#181818]/45 px-3 py-2.5 hover:border-[#404040]"
          />
        ))}
      </div>
    )
  }

  const min = question.options?.min ?? 1
  const max = question.options?.max ?? 5
  const scale = Array.from({ length: Math.max(1, max - min + 1) }, (_, idx) => min + idx)
  const selected = typeof value === 'number' ? value : Number(value)

  return (
    <div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(scale.length, 10)}, minmax(0, 1fr))` }}>
        {scale.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={cn(
              'h-10 rounded-[9px] border text-[13px] font-semibold transition-colors',
              selected === item
                ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/16 text-[#d4d4d4]'
                : 'border-[#343434]/60 bg-[#181818]/45 text-[#aeaeae] hover:border-[#404040]',
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {(question.options?.minLabel || question.options?.maxLabel) && (
        <div className="mt-2 flex justify-between gap-4 text-[11.5px] text-[#909090]">
          <span>{question.options?.minLabel}</span>
          <span>{question.options?.maxLabel}</span>
        </div>
      )}
    </div>
  )
}
