'use client'

import { MinusCircle, Pencil, PlusCircle, StickyNote, Trash2, type LucideIcon } from 'lucide-react'

import {
  QC_ENTRY_KIND_LABELS,
  QC_GRADE_LABELS,
  QC_RATING_LABELS,
  correctedEntryIds,
  entryBalance,
  formatQcGrade,
  isQcGrade,
  qcBaseGrade,
  type QcEntryKind,
  type QcRating,
} from '@/lib/quality-checks'
import { cn, formatDateTime } from '@/lib/utils'

export interface QcEntry {
  id: string
  kind: string
  text: string
  occurredAt: string
  correctsId: string | null
  authorName?: string
  createdAt?: string
  editedAt?: string | null
}

export interface QcCheck {
  id: string
  number: string
  lspdOfficerId: string
  officerName: string
  officerBadge: string
  officerRank: string
  status: string
  rating: string | null
  grade: number | null
  startedAt: string
  endedAt: string | null
  location: string | null
  summary: string | null
  conductorName: string
  entries: QcEntry[]
}

export const KIND_STYLE: Record<QcEntryKind, { icon: LucideIcon; text: string; border: string; bg: string }> = {
  POSITIVE: { icon: PlusCircle, text: 'text-[#30d158]', border: 'border-[#30d158]/40', bg: 'bg-[#30d158]/10' },
  NEGATIVE: { icon: MinusCircle, text: 'text-[#ff453a]', border: 'border-[#ff453a]/40', bg: 'bg-[#ff453a]/10' },
  NOTE: { icon: StickyNote, text: 'text-[#c7c7cc]', border: 'border-[#48484a]', bg: 'bg-[#2c2c2e]/40' },
}

const RATING_STYLE: Record<QcRating, string> = {
  POSITIVE: 'bg-[#30d158]/15 text-[#30d158]',
  NEUTRAL: 'bg-[#8e8e93]/20 text-[#d4d4d4]',
  NEGATIVE: 'bg-[#ff453a]/15 text-[#ff6961]',
}

export function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating || !(rating in RATING_STYLE)) {
    return <span className="rounded-full bg-[#0a84ff]/15 px-2 py-0.5 text-[11.5px] font-medium text-[#64d2ff]">Läuft</span>
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium', RATING_STYLE[rating as QcRating])}>
      {QC_RATING_LABELS[rating as QcRating]}
    </span>
  )
}

const GRADE_STYLE = ['', 'text-[#30d158]', 'text-[#30d158]', 'text-[#d4d4d4]', 'text-[#ffd60a]', 'text-[#ff6961]', 'text-[#ff6961]']

/** Schulnote 1+ bis 6; ohne Note nichts anzeigen. */
export function GradeBadge({ grade, long = false }: { grade: number | null | undefined; long?: boolean }) {
  if (!isQcGrade(grade)) return null
  const base = qcBaseGrade(grade)
  return (
    <span
      title={`Note ${formatQcGrade(grade)} – ${QC_GRADE_LABELS[base]}`}
      className={cn('rounded-full bg-[#2c2c2e] px-2 py-0.5 font-mono text-[11.5px] font-semibold', GRADE_STYLE[base])}
    >
      Note {formatQcGrade(grade)}
      {long && <span className="font-sans font-medium"> · {QC_GRADE_LABELS[base]}</span>}
    </span>
  )
}

/** Durchschnittsnote, eine Nachkommastelle; `–` solange keine Note vergeben ist. */
export function AverageGrade({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-[#636366]" title="Noch keine Note">–</span>
  const label = QC_GRADE_LABELS[qcBaseGrade(value)]
  const color = value <= 2.5 ? 'text-[#30d158]' : value <= 3.5 ? 'text-[#d4d4d4]' : value <= 4.5 ? 'text-[#ffd60a]' : 'text-[#ff6961]'
  return (
    <span className={color} title={`Durchschnittsnote ${value.toLocaleString('de-DE')} – ${label}`}>
      {value.toLocaleString('de-DE', { minimumFractionDigits: 1 })}
    </span>
  )
}

export function BalanceChips({ entries }: { entries: Pick<QcEntry, 'id' | 'kind' | 'correctsId'>[] }) {
  const balance = entryBalance(entries)
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11.5px]">
      <span className="text-[#30d158]">+{balance.positive}</span>
      <span className="text-[#ff453a]">−{balance.negative}</span>
      <span className="text-[#8e8e93]">✎{balance.notes}</span>
    </span>
  )
}

const timeFormat = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

/**
 * Protokoll einer Kontrolle. Korrigierte Einträge bleiben sichtbar (durchgestrichen),
 * damit das Protokoll nachvollziehbar bleibt.
 */
export function QcEntryList({
  entries,
  showAuthors = true,
  onCorrect,
  onEdit,
  onDelete,
}: {
  entries: QcEntry[]
  showAuthors?: boolean
  onCorrect?: (entry: QcEntry) => void
  onEdit?: (entry: QcEntry) => void
  onDelete?: (entry: QcEntry) => void
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-[#8e8e93]">Noch keine Einträge.</p>
  }
  const corrected = correctedEntryIds(entries)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const correctionOf = new Map(entries.filter((entry) => entry.correctsId).map((entry) => [entry.correctsId!, entry]))

  return (
    <ol className="space-y-2">
      {entries.map((entry) => {
        const style = KIND_STYLE[entry.kind as QcEntryKind] ?? KIND_STYLE.NOTE
        const Icon = style.icon
        const isCorrected = corrected.has(entry.id)
        const replacement = correctionOf.get(entry.id)
        const original = entry.correctsId ? byId.get(entry.correctsId) : null
        return (
          <li
            key={entry.id}
            className={cn('rounded-[10px] border p-3', style.border, style.bg, isCorrected && 'opacity-55')}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
              <Icon className={cn('h-3.5 w-3.5', style.text)} aria-hidden />
              <span className={cn('font-semibold', style.text)}>{QC_ENTRY_KIND_LABELS[entry.kind as QcEntryKind] ?? entry.kind}</span>
              <time dateTime={entry.occurredAt} className="font-mono text-[#98989d]" title={formatDateTime(entry.occurredAt)}>
                {timeFormat(entry.occurredAt)}
              </time>
              {showAuthors && entry.authorName && <span className="text-[#8e8e93]">· {entry.authorName}</span>}
              {original && <span className="text-[#ffd60a]">· Korrektur zum Eintrag {timeFormat(original.occurredAt)}</span>}
              {isCorrected && replacement && <span className="text-[#ffd60a]">· korrigiert um {timeFormat(replacement.occurredAt)}</span>}
              {entry.editedAt && (
                <span className="text-[#8e8e93]" title={`Bearbeitet ${formatDateTime(entry.editedAt)}`}>· bearbeitet</span>
              )}
              {(onCorrect || onEdit || onDelete) && (
                <span className="ml-auto flex items-center gap-3">
                  {onCorrect && !isCorrected && (
                    <button type="button" onClick={() => onCorrect(entry)} className="text-[#98989d] hover:text-white">
                      Korrigieren
                    </button>
                  )}
                  {onEdit && (
                    <button type="button" onClick={() => onEdit(entry)} className="text-[#98989d] hover:text-white" aria-label="Eintrag bearbeiten" title="Bearbeiten">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDelete && (
                    <button type="button" onClick={() => onDelete(entry)} className="text-[#98989d] hover:text-[#ff6961]" aria-label="Eintrag löschen" title="Löschen">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              )}
            </div>
            <p className={cn('mt-1 whitespace-pre-wrap break-words text-[13px] text-[#f5f5f7]', isCorrected && 'line-through')}>
              {entry.text}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
