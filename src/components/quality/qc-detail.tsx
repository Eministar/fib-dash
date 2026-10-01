'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Link2, MapPin } from 'lucide-react'

import { Breadcrumbs } from '@/components/layout/breadcrumbs'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import {
  QC_BASE_GRADES,
  QC_ENTRY_KIND_LABELS,
  QC_GRADE_LABELS,
  QC_GRADE_TENDENCY,
  QC_RATINGS,
  QC_RATING_LABELS,
  entryBalance,
  formatQcGrade,
  qcBaseGrade,
  suggestRating,
  type QcEntryKind,
  type QcRating,
} from '@/lib/quality-checks'
import { cn, formatDateTime } from '@/lib/utils'
import { BalanceChips, GradeBadge, KIND_STYLE, QcEntryList, RatingBadge, type QcCheck, type QcEntry } from './qc-shared'
import { ShareDialog } from './qc-dialogs'

export function QualityCheckDetail({ checkId }: { checkId: string }) {
  const { user } = useAuth()
  const canView = hasPermission(user, 'quality-checks:view')
  const canManage = hasPermission(user, 'quality-checks:manage')
  const { data: check, loading, error, refetch } = useFetch<QcCheck>(canView ? `/api/quality-checks/${checkId}` : null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [correcting, setCorrecting] = useState<QcEntry | null>(null)
  const [editing, setEditing] = useState<QcEntry | null>(null)
  const confirm = useConfirm()
  const { addToast } = useToast()
  const { execute } = useApi()

  const deleteEntry = async (entry: QcEntry) => {
    const ok = await confirm({
      title: 'Eintrag löschen?',
      description: `„${entry.text.slice(0, 120)}${entry.text.length > 120 ? '…' : ''}“ wird aus dem Protokoll entfernt.`,
      confirmLabel: 'Löschen',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await execute(`/api/quality-checks/${checkId}/entries/${entry.id}`, { method: 'DELETE' })
      if (correcting?.id === entry.id) setCorrecting(null)
      void refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Eintrag nicht gelöscht', message: cause instanceof Error ? cause.message : '' })
    }
  }

  if (!canView) return <UnauthorizedContent />
  if (loading && !check) return <PageLoader withHeader />
  if (!check) return <Card className="py-14 text-center text-[13px] text-[#98989d]">{error || 'Kontrolle nicht gefunden.'}</Card>

  const running = check.status === 'RUNNING'

  return (
    <div className="mx-auto max-w-3xl pb-6">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: 'Qualitätskontrollen', href: '/quality-checks' },
          { label: check.officerName, href: `/quality-checks/officers/${check.lspdOfficerId}` },
          { label: check.number },
        ]}
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[12px] text-[#d4af37]">{check.number}</p>
            <h1 className="mt-0.5 text-[19px] font-semibold text-white">
              <Link href={`/quality-checks/officers/${check.lspdOfficerId}`} className="hover:underline">{check.officerName}</Link>
            </h1>
            <p className="mt-1 text-[12.5px] text-[#98989d]">
              DN {check.officerBadge} · {check.officerRank} · Prüfer: {check.conductorName}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-[#8e8e93]">
              <span>Beginn {formatDateTime(check.startedAt)}</span>
              {check.endedAt && <span>Ende {formatDateTime(check.endedAt)}</span>}
              {check.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {check.location}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <GradeBadge grade={check.grade} long />
              <RatingBadge rating={check.rating} />
            </div>
            <BalanceChips entries={check.entries} />
          </div>
        </div>

        {running && canManage && <GradePicker checkId={check.id} grade={check.grade} onSaved={() => void refetch()} />}

        {check.summary && (
          <div className="mt-4 border-t border-[#2c2c2e] pt-3">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-[#8e8e93]">Fazit</p>
            <p className="whitespace-pre-wrap text-[13px] text-[#e5e5ea]">{check.summary}</p>
          </div>
        )}

        {canManage && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#2c2c2e] pt-3">
            {running && (
              <Button onClick={() => setCompleteOpen(true)}>
                <CheckCircle2 className="h-4 w-4" />
                Kontrolle abschließen
              </Button>
            )}
            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <Link2 className="h-4 w-4" />
              Freigabelink erstellen
            </Button>
          </div>
        )}
      </Card>

      {running && canManage && (
        <EntryComposer
          checkId={check.id}
          correcting={correcting}
          onCancelCorrection={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null)
            void refetch()
          }}
        />
      )}

      <Card>
        <h2 className="mb-3 text-[14px] font-semibold text-white">Protokoll ({check.entries.length})</h2>
        <QcEntryList
          entries={check.entries}
          onCorrect={running && canManage ? setCorrecting : undefined}
          onEdit={running && canManage ? setEditing : undefined}
          onDelete={running && canManage ? (entry) => void deleteEntry(entry) : undefined}
        />
      </Card>

      {editing && (
        <EditEntryDialog
          checkId={check.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refetch()
          }}
        />
      )}

      {completeOpen && (
        <CompleteDialog check={check} onClose={() => setCompleteOpen(false)} onSaved={() => { setCompleteOpen(false); void refetch() }} />
      )}
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        scope="CHECK"
        checkId={check.id}
        defaultTitle={`${check.number} · ${check.officerName}`}
      />
    </div>
  )
}

/** Note schon während der Mitfahrt setzen; nochmal tippen nimmt sie zurück. */
function GradePicker({ checkId, grade, onSaved }: { checkId: string; grade: number | null; onSaved: () => void }) {
  const { addToast } = useToast()
  const { execute, loading } = useApi()

  const save = async (next: number | null) => {
    try {
      await execute(`/api/quality-checks/${checkId}/grade`, { method: 'PUT', body: JSON.stringify({ grade: next }) })
      onSaved()
    } catch (cause) {
      addToast({ type: 'error', title: 'Note nicht gespeichert', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return (
    <div className="mt-4 border-t border-[#2c2c2e] pt-3">
      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-[#8e8e93]">Note</p>
      <GradeButtons value={grade} disabled={loading} onChange={(next) => void save(sameGrade(next, grade) ? null : next)} />
    </div>
  )
}

const sameGrade = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 0.001
const withTendency = (base: number, sign: -1 | 1) => Math.round((base + sign * QC_GRADE_TENDENCY) * 10) / 10

/** Je Spalte eine ganze Note, darüber die Tendenz nach oben (1+), darunter nach unten (1−). */
function GradeButtons({ value, disabled, onChange }: { value: number | null; disabled?: boolean; onChange: (grade: number) => void }) {
  const option = (grade: number, main: boolean) => {
    const active = sameGrade(value, grade)
    const label = QC_GRADE_LABELS[qcBaseGrade(grade)]
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`Note ${formatQcGrade(grade)}`}
        title={`${formatQcGrade(grade)} – ${label}`}
        disabled={disabled}
        onClick={() => onChange(grade)}
        className={cn(
          'flex flex-col items-center justify-center rounded-[10px] border font-semibold leading-tight disabled:opacity-60',
          main ? 'h-11' : 'h-7 font-mono text-[12.5px]',
          active ? 'border-white/60 bg-[#2c2c2e] text-white' : 'border-[#38383a] text-[#8e8e93] hover:bg-[#1c1c1e]',
        )}
      >
        {main ? (
          <>
            <span className="text-[15px]">{grade}</span>
            <span className="hidden text-[10px] font-normal sm:block">{label}</span>
          </>
        ) : (
          formatQcGrade(grade)
        )}
      </button>
    )
  }

  return (
    <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Note">
      {QC_BASE_GRADES.map((base) => (
        <div key={base} className="flex flex-col gap-1">
          {base === 6 ? <span className="h-7" aria-hidden /> : option(withTendency(base, -1), false)}
          {option(base, true)}
          {base === 6 ? <span className="h-7" aria-hidden /> : option(withTendency(base, 1), false)}
        </div>
      ))}
    </div>
  )
}

function KindButtons({ value, onChange }: { value: QcEntryKind; onChange: (kind: QcEntryKind) => void }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Art des Eintrags">
      {(['POSITIVE', 'NEGATIVE', 'NOTE'] as const).map((kind) => {
        const style = KIND_STYLE[kind]
        const Icon = style.icon
        const active = value === kind
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(kind)}
            className={cn(
              'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-[12px] border text-[13px] font-semibold transition-colors',
              active ? cn(style.border, style.bg, style.text) : 'border-[#38383a] text-[#8e8e93] hover:bg-[#2c2c2e]',
            )}
          >
            <Icon className="h-5 w-5" />
            {QC_ENTRY_KIND_LABELS[kind]}
          </button>
        )
      })}
    </div>
  )
}

/** ISO-Zeitpunkt → Wert für `<input type="datetime-local">` in Ortszeit. */
function toLocalInput(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function EditEntryDialog({ checkId, entry, onClose, onSaved }: { checkId: string; entry: QcEntry; onClose: () => void; onSaved: () => void }) {
  const { execute, loading } = useApi()
  const [kind, setKind] = useState<QcEntryKind>((entry.kind as QcEntryKind) ?? 'NOTE')
  const [text, setText] = useState(entry.text)
  const [time, setTime] = useState(toLocalInput(entry.occurredAt))
  const [failure, setFailure] = useState('')

  const save = async () => {
    setFailure('')
    try {
      await execute(`/api/quality-checks/${checkId}/entries/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ kind, text, ...(time ? { occurredAt: new Date(time).toISOString() } : {}) }),
      })
      onSaved()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen')
    }
  }

  return (
    <Modal open onClose={loading ? () => {} : onClose} title="Eintrag bearbeiten" size="lg">
      <KindButtons value={kind} onChange={setKind} />
      <Textarea label="Beobachtung" rows={4} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} />
      <label className="mt-3 block text-[12px] text-[#98989d]">
        Zeitpunkt
        <input
          type="datetime-local"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="mt-1 block h-[34px] rounded-[8px] border border-[#38383a] bg-[#1c1c1e] px-2 text-[12.5px] text-white"
        />
      </label>
      {failure && <p role="alert" className="mt-3 text-[12.5px] text-[#fca5a5]">{failure}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={loading}>Abbrechen</Button>
        <Button onClick={() => void save()} loading={loading} disabled={!text.trim()}>Speichern</Button>
      </div>
    </Modal>
  )
}

/**
 * Mitfahrt-Modus: Art wählen, Text tippen, speichern. Der Zeitstempel ist
 * „jetzt“; bei Nachträgen lässt er sich anpassen.
 */
function EntryComposer({
  checkId,
  correcting,
  onCancelCorrection,
  onSaved,
}: {
  checkId: string
  correcting: QcEntry | null
  onCancelCorrection: () => void
  onSaved: () => void
}) {
  const { addToast } = useToast()
  const { execute, loading } = useApi()
  const [kind, setKind] = useState<QcEntryKind>('POSITIVE')
  const [text, setText] = useState('')
  const [customTime, setCustomTime] = useState('')

  const save = async () => {
    if (!text.trim()) return
    try {
      await execute(`/api/quality-checks/${checkId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          text,
          ...(customTime ? { occurredAt: new Date(customTime).toISOString() } : {}),
          ...(correcting ? { correctsId: correcting.id } : {}),
        }),
      })
      setText('')
      setCustomTime('')
      onSaved()
    } catch (cause) {
      addToast({ type: 'error', title: 'Eintrag nicht gespeichert', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return (
    <Card className="mb-4">
      {correcting && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-[8px] border border-[#ffd60a]/40 bg-[#ffd60a]/10 p-2.5 text-[12px] text-[#ffd60a]">
          <span>Korrektur zu: „{correcting.text.slice(0, 120)}{correcting.text.length > 120 ? '…' : ''}“</span>
          <button type="button" onClick={onCancelCorrection} className="shrink-0 text-[#e5e5ea] hover:text-white">Abbrechen</button>
        </div>
      )}
      <KindButtons value={kind} onChange={setKind} />
      <Textarea
        label="Beobachtung"
        rows={3}
        maxLength={5000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void save()
          }
        }}
        placeholder="Was ist passiert? (Strg+Enter speichert)"
      />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <label className="text-[12px] text-[#98989d]">
          Zeitpunkt (leer = jetzt)
          <input
            type="datetime-local"
            value={customTime}
            onChange={(event) => setCustomTime(event.target.value)}
            className="mt-1 block h-[34px] rounded-[8px] border border-[#38383a] bg-[#1c1c1e] px-2 text-[12.5px] text-white"
          />
        </label>
        <Button onClick={() => void save()} loading={loading} disabled={!text.trim()} className="min-w-[140px]">
          {correcting ? 'Korrektur speichern' : 'Eintrag speichern'}
        </Button>
      </div>
    </Card>
  )
}

function CompleteDialog({ check, onClose, onSaved }: { check: QcCheck; onClose: () => void; onSaved: () => void }) {
  const suggestion = suggestRating(entryBalance(check.entries))
  const { execute, loading } = useApi()
  const [rating, setRating] = useState<QcRating>(suggestion)
  const [grade, setGrade] = useState<number | null>(check.grade)
  const [summary, setSummary] = useState('')
  const [failure, setFailure] = useState('')

  const save = async () => {
    setFailure('')
    try {
      await execute(`/api/quality-checks/${check.id}`, { method: 'PATCH', body: JSON.stringify({ rating, grade, summary }) })
      onSaved()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Abschließen fehlgeschlagen')
    }
  }

  return (
    <Modal open onClose={loading ? () => {} : onClose} title={`${check.number} abschließen`} description="Danach lässt sich das Protokoll nicht mehr ergänzen." size="lg">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-[#c7c7cc]">
            Gesamtbewertung <span className="font-normal text-[#8e8e93]">(Vorschlag aus der Bilanz: {QC_RATING_LABELS[suggestion]})</span>
          </p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gesamtbewertung">
            {QC_RATINGS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                onClick={() => setRating(value)}
                className={cn(
                  'h-11 rounded-[10px] border text-[13px] font-semibold',
                  rating === value ? 'border-white/60 bg-[#2c2c2e] text-white' : 'border-[#38383a] text-[#8e8e93] hover:bg-[#1c1c1e]',
                )}
              >
                {QC_RATING_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-[#c7c7cc]">
            Note <span className="font-normal text-[#8e8e93]">(optional)</span>
          </p>
          <GradeButtons value={grade} onChange={(next) => setGrade(sameGrade(next, grade) ? null : next)} />
        </div>
        <Textarea label="Fazit" rows={5} maxLength={20000} value={summary} onChange={(event) => setSummary(event.target.value)} required />
        {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Abbrechen</Button>
          <Button onClick={() => void save()} loading={loading} disabled={!summary.trim()}>Abschließen</Button>
        </div>
      </div>
    </Modal>
  )
}
