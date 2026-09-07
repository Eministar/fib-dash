'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock, FileQuestion, PlayCircle, Send, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { cn, formatDateTime } from '@/lib/utils'

type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'SCALE'
type FormTestKind = 'TEST' | 'SURVEY'

interface QuestionOptions {
  choices?: string[]
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
}

interface FormQuestion {
  id: string
  type: QuestionType
  title: string
  description: string | null
  required: boolean
  options: QuestionOptions | null
  points: number
  sortOrder: number
}

interface ExistingResponse {
  id: string
  submittedAt: string
  score: number | null
  maxScore: number
}

interface FormLinkPayload {
  id: string
  kind: FormTestKind
  title: string
  description: string | null
  module: string
  timeLimitMinutes: number | null
  anonymousResponses: boolean
  questions: FormQuestion[]
  questionCount: number
  started: boolean
  existingResponse: ExistingResponse | null
  sessionStartedAt: string | null
  sessionExpiresAt: string | null
  securityEventCount: number
}

function paramToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

function formatRemainingTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function FormTestLinkPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = paramToken(params.token)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [focusWarning, setFocusWarning] = useState(false)
  const [screenshotCover, setScreenshotCover] = useState(false)
  const [windowObscured, setWindowObscured] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [watermarkStamp, setWatermarkStamp] = useState(() => Date.now())
  const securityToastAtRef = useRef(0)
  const coverTimeoutRef = useRef<number | null>(null)
  const { data, loading, error: loadError, refetch } = useFetch<FormLinkPayload>(token ? `/api/form-links/${token}` : null)
  const { execute } = useApi()
  const { addToast } = useToast()
  const { user } = useAuth()
  // Nur ein wirklich gestarteter Test ist "aktiv": vorher gibt es weder Uhr
  // noch Fragen, also auch keinen Testmodus mit Sperren und Wasserzeichen.
  const isActiveTest = data?.kind === 'TEST' && !data.existingResponse && data.started
  const needsStart = data?.kind === 'TEST' && !data.existingResponse && !data.started
  const timeExpired = isActiveTest && remainingMs !== null && remainingMs <= 0

  const watermarkStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!user) return undefined
    const sanitize = (value: string) => value.replace(/[<>&]/g, ' ').slice(0, 60)
    const identity = sanitize(`${user.displayName} · ${user.discordId ?? user.username}`)
    const stamp = sanitize(new Date(watermarkStamp).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='330' height='210'><g transform='rotate(-28 165 105)'><text x='12' y='98' fill='rgba(212,212,212,0.045)' font-family='Arial, sans-serif' font-size='13' font-weight='500'>${identity}</text><text x='12' y='118' fill='rgba(212,212,212,0.035)' font-family='Arial, sans-serif' font-size='11'>${stamp}</text></g></svg>`
    return {
      backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
      backgroundRepeat: 'repeat',
    }
  }, [user, watermarkStamp])

  const reportSecurityEvent = useCallback((type: string) => {
    if (!token) return
    void fetch(`/api/form-links/${token}/security-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
      cache: 'no-store',
    }).catch(() => undefined)
  }, [token])

  useEffect(() => {
    if (isActiveTest) notifyLiveUpdate()
  }, [data?.sessionStartedAt, isActiveTest])

  useEffect(() => {
    if (!isActiveTest) return
    const intervalId = window.setInterval(() => setWatermarkStamp(Date.now()), 60000)
    return () => window.clearInterval(intervalId)
  }, [isActiveTest])

  const answeredRequired = useMemo(() => {
    if (!data) return false
    return data.questions.every((question) => {
      if (!question.required) return true
      const value = answers[question.id]
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && String(value).trim() !== ''
    })
  }, [answers, data])

  useEffect(() => {
    if (!isActiveTest || !data?.sessionExpiresAt) {
      setRemainingMs(null)
      return
    }

    const expiresAt = new Date(data.sessionExpiresAt).getTime()
    const updateRemaining = () => setRemainingMs(Math.max(0, expiresAt - Date.now()))
    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, 1000)
    return () => window.clearInterval(intervalId)
  }, [data?.sessionExpiresAt, isActiveTest])

  useEffect(() => {
    if (!isActiveTest) return

    const showScreenshotCover = () => {
      setScreenshotCover(true)
      if (coverTimeoutRef.current) window.clearTimeout(coverTimeoutRef.current)
      coverTimeoutRef.current = window.setTimeout(() => {
        setScreenshotCover(false)
        coverTimeoutRef.current = null
      }, 4500)
    }

    const writeAttemptClipboard = () => {
      if ('clipboard' in navigator) {
        void navigator.clipboard.writeText('netter versuch').catch(() => undefined)
      }
    }

    const notifyBlockedAction = (type: string, message = 'Diese Aktion ist während des Tests gesperrt') => {
      reportSecurityEvent(type)
      const now = Date.now()
      if (now - securityToastAtRef.current > 2500) {
        securityToastAtRef.current = now
        addToast({ type: 'warning', title: message })
      }
    }

    const blockEvent = (event: Event, type: string) => {
      event.preventDefault()
      event.stopPropagation()
      notifyBlockedAction(type)
    }

    const handleClipboard = (event: ClipboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'copy' || event.type === 'cut') {
        event.clipboardData?.setData('text/plain', 'netter versuch')
        writeAttemptClipboard()
      }
      notifyBlockedAction(event.type, event.type === 'paste' ? 'Einfügen ist während des Tests gesperrt' : 'netter versuch')
    }
    const handleContextMenu = (event: MouseEvent) => blockEvent(event, 'contextmenu')
    const handleDragStart = (event: DragEvent) => blockEvent(event, 'dragstart')
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const blockedShortcut = (event.ctrlKey || event.metaKey) && ['a', 'c', 'p', 's', 'u', 'v', 'x'].includes(key)
      if (blockedShortcut || event.key === 'PrintScreen') {
        event.preventDefault()
        event.stopPropagation()
        if (key === 'c' || key === 'x') writeAttemptClipboard()
        if (key === 'p' || event.key === 'PrintScreen') showScreenshotCover()
        notifyBlockedAction(event.key === 'PrintScreen' ? 'printscreen-key' : `shortcut-${key}`)
      }
    }
    const handleBeforePrint = (event: Event) => {
      showScreenshotCover()
      blockEvent(event, 'beforeprint')
    }
    const handleBlur = () => {
      setWindowObscured(true)
      setFocusWarning(true)
      reportSecurityEvent('window-blur')
    }
    const handleFocus = () => {
      setWindowObscured(false)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setWindowObscured(true)
        setFocusWarning(true)
        reportSecurityEvent('tab-hidden')
      } else {
        setWindowObscured(false)
      }
    }

    document.addEventListener('copy', handleClipboard, true)
    document.addEventListener('cut', handleClipboard, true)
    document.addEventListener('paste', handleClipboard, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('dragstart', handleDragStart, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('beforeprint', handleBeforePrint)

    return () => {
      document.removeEventListener('copy', handleClipboard, true)
      document.removeEventListener('cut', handleClipboard, true)
      document.removeEventListener('paste', handleClipboard, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('dragstart', handleDragStart, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('beforeprint', handleBeforePrint)
      if (coverTimeoutRef.current) window.clearTimeout(coverTimeoutRef.current)
    }
  }, [addToast, isActiveTest, reportSecurityEvent])

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((current) => ({ ...current, [questionId]: value }))
  }

  const startTest = async () => {
    setStarting(true)
    try {
      await execute(`/api/form-links/${token}/start`, { method: 'POST' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Test konnte nicht gestartet werden', message: e instanceof Error ? e.message : '' })
    } finally {
      setStarting(false)
    }
  }

  const submit = async () => {
    if (!data) return
    if (timeExpired) {
      addToast({ type: 'error', title: 'Zeit abgelaufen' })
      return
    }
    setSubmitting(true)
    try {
      await execute(`/api/form-links/${token}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      })
      addToast({ type: 'success', title: 'Abgabe gespeichert' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Abgabe fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageLoader />

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 px-6 py-16 text-center">
          <FileQuestion size={30} className="mx-auto mb-3 text-[#808080]" />
          <p className="text-[14px] font-semibold text-white">Test nicht verfügbar</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-5 text-[#a6a6a6]">
            {loadError ?? 'Der Link ist nicht aktiv oder nicht verfügbar.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Erneut versuchen
            </Button>
          </div>
          <p className="mx-auto mt-4 max-w-md text-[11.5px] leading-5 text-[#909090]">
            Tipp: Der Link muss vollständig kopiert werden — angehängte Satzzeichen oder ein
            abgeschnittenes Ende machen ihn ungültig. Hilft das nicht, fordere den Link neu an.
          </p>
        </div>
      </div>
    )
  }

  if (data.existingResponse) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={data.title}
          description={data.description ?? undefined}
          eyebrow={data.kind === 'SURVEY' ? 'Umfrage abgegeben' : 'Test abgegeben'}
        />
        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#123026] text-[#86efac]">
            <CheckCircle2 size={28} />
          </div>
          <h2 className="text-[17px] font-semibold text-white">Deine Abgabe wurde gespeichert</h2>
          <p className="mt-2 text-[13px] text-[#a6a6a6]">
            Abgegeben am {formatDateTime(data.existingResponse.submittedAt)}
          </p>
          {data.existingResponse.maxScore > 0 && (
            <Badge className="mt-4" variant="success">
              {data.existingResponse.score ?? '-'} / {data.existingResponse.maxScore} Punkte
            </Badge>
          )}
        </div>
      </div>
    )
  }

  if (needsStart) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={data.title} description={data.description ?? undefined} eyebrow="Test" />

        <div className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[12px] border border-[#343434]/60 bg-[#181818]/45 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
                <ClipboardCheck size={13} className="text-[#d4d4d4]" />
                Umfang
              </div>
              <p className="mt-1.5 text-[14px] font-semibold text-white">{data.questionCount} Frage(n)</p>
            </div>
            <div className="rounded-[12px] border border-[#343434]/60 bg-[#181818]/45 px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[#737373]">
                <Clock size={13} className="text-[#d4d4d4]" />
                Zeitlimit
              </div>
              <p className="mt-1.5 text-[14px] font-semibold text-white">
                {data.timeLimitMinutes ? `${data.timeLimitMinutes} Minuten` : 'Kein Zeitlimit'}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[12px] border border-[#d4d4d4]/30 bg-[#302712]/45 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
              <div>
                <p className="text-[13px] font-semibold text-white">Vor dem Start lesen</p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-5 text-[#c6c6c6]">
                  <li>
                    {data.timeLimitMinutes
                      ? `Die Zeit läuft ab dem Klick auf „Test starten“ — ${data.timeLimitMinutes} Minuten, auch wenn du die Seite schließt.`
                      : 'Der Test beginnt erst mit dem Klick auf „Test starten“.'}
                  </li>
                  <li>Kopieren, Einfügen, Drucken, Rechtsklick und Tabwechsel werden blockiert oder protokolliert.</li>
                  <li>Jeder Screenshot trägt sichtbar deinen Namen und deine Discord-ID.</li>
                  <li>Andere Dashboard-Seiten bleiben bis zur Abgabe gesperrt. Es gibt nur einen Versuch.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Button onClick={startTest} loading={starting} disabled={data.questionCount === 0}>
              <PlayCircle size={15} />
              Test starten
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const remainingLabel = isActiveTest && data.sessionExpiresAt && remainingMs !== null
    ? formatRemainingTime(remainingMs)
    : null

  return (
    <div className={cn('mx-auto max-w-3xl', isActiveTest && 'select-none')}>
      {isActiveTest && (
        <style>
          {`@media print { html, body { background: #0c0c0c !important; } body * { visibility: hidden !important; } }`}
        </style>
      )}
      {isActiveTest && watermarkStyle && (
        <div className="pointer-events-none fixed inset-0 z-[60]" style={watermarkStyle} aria-hidden="true" />
      )}
      {isActiveTest && (screenshotCover || windowObscured) && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-[#0c0c0c] px-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/10 text-[#d4d4d4]">
            <ShieldAlert size={30} />
          </div>
          <div>
            <p className="text-[16px] font-semibold text-white">Inhalt geschützt</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-[#a6a6a6]">
              Der Testinhalt wird ausgeblendet, sobald das Fenster verlassen wird oder ein Screenshot bzw. eine Aufnahme erkannt wird. Kehre zum Test-Tab zurück, um fortzufahren.
            </p>
          </div>
        </div>
      )}
      <PageHeader
        title={data.title}
        description={data.description ?? undefined}
        eyebrow={data.kind === 'SURVEY' ? 'Umfrage' : 'Test'}
        action={remainingLabel ? (
          <Badge variant={timeExpired ? 'danger' : 'warning'} className="gap-1.5">
            <Clock size={13} />
            {remainingLabel}
          </Badge>
        ) : data.kind === 'SURVEY' && data.anonymousResponses ? (
          <Badge variant="info">Anonyme Umfrage</Badge>
        ) : undefined}
      />

      {isActiveTest && (
        <div className="mb-4 rounded-[14px] border border-[#d4d4d4]/30 bg-[#302712]/45 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
            <div>
              <p className="text-[13px] font-semibold text-white">Testmodus aktiv</p>
              <p className="mt-1 text-[12.5px] leading-5 text-[#c6c6c6]">
                Kopieren, Einfügen, Drucken, Rechtsklick und Tabwechsel werden blockiert oder protokolliert. Jeder Screenshot trägt sichtbar deinen Namen und deine Discord-ID – geleakte Aufnahmen sind dir eindeutig zuordenbar. Andere Dashboard-Seiten bleiben bis zur Abgabe gesperrt.
              </p>
            </div>
          </div>
        </div>
      )}

      {focusWarning && isActiveTest && (
        <div className="mb-4 rounded-[14px] border border-[#7f1d1d]/45 bg-[#2a1620]/55 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#fca5a5]" />
            <div>
              <p className="text-[13px] font-semibold text-white">Fokusverlust protokolliert</p>
              <p className="mt-1 text-[12.5px] leading-5 text-[#f3b7b7]">
                Der Test wurde verlassen oder das Fenster hat den Fokus verloren.
              </p>
            </div>
          </div>
        </div>
      )}

      {data.kind === 'SURVEY' && data.anonymousResponses && (
        <div className="mb-4 rounded-[14px] border border-[#373737]/45 bg-[#181818]/55 p-4 text-[12.5px] leading-5 text-[#a6a6a6]">
          Diese Umfrage wird anonym ausgewertet. Deine Abgabe wird intern nur zur Vermeidung mehrfacher Abgaben erkannt.
        </div>
      )}

      <div className="space-y-4">
        {data.questions.map((question, index) => (
          <QuestionField
            key={question.id}
            index={index}
            question={question}
            showPoints={data.kind === 'TEST'}
            value={answers[question.id]}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}
      </div>

      <div className="sticky bottom-0 mt-5 rounded-[14px] border border-[#373737]/45 bg-[#080808]/90 p-3 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[12.5px] text-[#a6a6a6]">
            <ClipboardCheck size={15} className="text-[#d4d4d4]" />
            {data.questions.length} Frage(n)
            {isActiveTest && data.securityEventCount > 0 && (
              <span className="text-[#d4d4d4]">· {data.securityEventCount} protokolliert</span>
            )}
          </div>
          <Button onClick={submit} loading={submitting} disabled={!answeredRequired || timeExpired}>
            <Send size={14} />
            {timeExpired ? 'Zeit abgelaufen' : 'Abgeben'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function QuestionField({
  index,
  question,
  showPoints,
  value,
  onChange,
}: {
  index: number
  question: FormQuestion
  showPoints: boolean
  value: unknown
  onChange: (value: unknown) => void
}) {
  return (
    <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#232323] text-[11.5px] font-semibold text-[#d4d4d4]">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-white">{question.title}</h2>
            {question.required && <Badge variant="warning">Pflicht</Badge>}
            {showPoints && question.points > 0 && <Badge>{question.points} Punkte</Badge>}
          </div>
          {question.description && <p className="mt-1 text-[12.5px] leading-5 text-[#a6a6a6]">{question.description}</p>}
        </div>
      </div>
      <QuestionInput question={question} value={value} onChange={onChange} />
    </section>
  )
}

function QuestionInput({ question, value, onChange }: { question: FormQuestion; value: unknown; onChange: (value: unknown) => void }) {
  if (question.type === 'SHORT_TEXT') {
    return (
      <input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-[38px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 text-[13.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
        placeholder="Antwort eingeben"
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
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">Nur eine Antwort wählbar</p>
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
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#d4d4d4]/70">Mehrfachauswahl möglich</p>
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
