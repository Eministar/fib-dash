'use client'

import Link from 'next/link'
import { BadgeCheck, CheckCircle2, Edit, Gavel, ShieldCheck, Trash2, Undo2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { displayBadgeNumber } from '@/lib/badge-number'
import {
  penalGradeLabel,
  requiresDualControl,
  resolveSanctionLevel,
  resolveViolation,
  sanctionLevelLabel,
} from '@/lib/sanction-catalog'
import { cn, formatDate, formatDateTime } from '@/lib/utils'

export type SanctionStatusValue = 'ISSUED' | 'EXECUTED' | 'IN_COURT' | 'UPHELD' | 'REVOKED'

export interface SanctionRecord {
  id: string
  reason: string
  /** Penal Grade "1"–"6". */
  penalGrade: string
  /** Sanktionsstufe "01"–"07". */
  level: string
  violationCode: string | null
  penalty: string | null
  status: SanctionStatusValue
  suspendedUntil: string | null
  executedAt: string | null
  resolvedAt: string | null
  confirmedAt: string | null
  repeatOfSanctionId: string | null
  createdAt: string
  updatedAt: string
  issuedBy: { displayName: string } | null
  confirmedBy?: { displayName: string } | null
}

/** Agent-Kopfzeile — nur auf Übersichtsseiten nötig, die mehrere Agents mischen. */
export interface SanctionCardAgent {
  id: string | null
  firstName: string
  lastName: string
  badgeNumber: string | null
  rankName: string | null
}

export function sanctionStatusLabel(status: SanctionStatusValue) {
  if (status === 'EXECUTED') return 'Vollzogen'
  if (status === 'IN_COURT') return 'Einspruch / Klage'
  if (status === 'UPHELD') return 'Bestätigt'
  if (status === 'REVOKED') return 'Aufgehoben'
  return 'Ausgesprochen'
}

export function sanctionStatusClass(status: SanctionStatusValue) {
  if (status === 'EXECUTED') return 'border-[#1d4ed8]/60 bg-[#0a1229]/60 text-[#93c5fd]'
  if (status === 'IN_COURT') return 'border-[#6d28d9]/60 bg-[#1a1030]/60 text-[#c4b5fd]'
  if (status === 'UPHELD') return 'border-[#166534]/60 bg-[#052e1a]/60 text-[#86efac]'
  if (status === 'REVOKED') return 'border-[#404040]/70 bg-[#141414]/70 text-[#a3a3a3]'
  return 'border-[#b45309]/50 bg-[#1d1608]/70 text-[#fbbf24]'
}

/** Zeitliche Einordnung — je nach Status der aussagekräftigste Zeitpunkt. */
export function sanctionTimingLabel(sanction: SanctionRecord) {
  if (sanction.status === 'REVOKED' && sanction.resolvedAt) {
    return `Aufgehoben am ${formatDateTime(sanction.resolvedAt)}`
  }
  if (sanction.status === 'UPHELD' && sanction.resolvedAt) {
    return `Bestätigt am ${formatDateTime(sanction.resolvedAt)}`
  }
  if (sanction.suspendedUntil) {
    return `Suspendiert bis ${formatDateTime(sanction.suspendedUntil)}`
  }
  if (sanction.executedAt) return `Vollzogen am ${formatDateTime(sanction.executedAt)}`
  return 'Vollzug ausstehend'
}

const SANCTION_STATUS_CONFIG: Record<SanctionStatusValue, {
  accent: string
  glow: string
  border: string
  bg: string
}> = {
  ISSUED: {
    accent: 'bg-[#d97706]',
    glow: 'shadow-[0_0_0_1px_rgba(217,119,6,0.2)]',
    border: 'border-[#d97706]/25',
    bg: 'bg-[#0d0a02]',
  },
  EXECUTED: {
    accent: 'bg-[#2563eb]',
    glow: 'shadow-[0_0_0_1px_rgba(37,99,235,0.18)]',
    border: 'border-[#2563eb]/25',
    bg: 'bg-[#02060d]',
  },
  IN_COURT: {
    accent: 'bg-[#8b5cf6]',
    glow: 'shadow-[0_0_0_1px_rgba(139,92,246,0.2)]',
    border: 'border-[#8b5cf6]/25',
    bg: 'bg-[#0a0616]',
  },
  UPHELD: {
    accent: 'bg-[#16a34a]',
    glow: 'shadow-[0_0_0_1px_rgba(22,163,74,0.15)]',
    border: 'border-[#16a34a]/20',
    bg: 'bg-[#020d04]',
  },
  REVOKED: {
    accent: 'bg-[#525252]',
    glow: 'shadow-[0_0_0_1px_rgba(82,82,82,0.18)]',
    border: 'border-[#525252]/25',
    bg: 'bg-[#0a0a0a]',
  },
}

/** Farbe der Stufen-Plakette — je schwerer die Maßnahme, desto wärmer. */
function levelBadgeClass(level: string) {
  if (level >= '06') return 'border-[#dc2626]/30 bg-[#dc2626]/10 text-[#fca5a5]'
  if (level >= '04') return 'border-[#f59e0b]/25 bg-[#f59e0b]/10 text-[#fcd34d]'
  return 'border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#7dd3fc]'
}

function AgentHeader({ agent }: { agent: SanctionCardAgent }) {
  const name = `${agent.firstName} ${agent.lastName}`.trim() || 'Unbekannter Agent'
  const meta = [displayBadgeNumber(agent.badgeNumber), agent.rankName].filter(Boolean).join(' · ')

  const content = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#212121]">
        <User size={13} className="text-[#a6a6a6]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-[#f4f4f4]">{name}</span>
        {meta && <span className="block truncate text-[11px] text-[#808080]">{meta}</span>}
      </span>
    </>
  )

  return (
    <div className="mb-3 flex items-center gap-2.5 border-b border-white/[0.05] pb-3">
      {agent.id ? (
        <Link href={`/agents/${agent.id}`} className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80">
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-2.5">{content}</div>
      )}
    </div>
  )
}

export function SanctionCard({
  sanction,
  canSanction,
  canConfirm,
  variant,
  agent,
  onExecute,
  onConfirm,
  onEdit,
  onRevoke,
  onDelete,
}: {
  sanction: SanctionRecord
  canSanction: boolean
  /** Berechtigung für die Vier-Augen-Bestätigung (Penal Grade 5/6). */
  canConfirm?: boolean
  variant: 'open' | 'history'
  /** Wenn gesetzt, zeigt die Karte, wen die Sanktion betrifft. */
  agent?: SanctionCardAgent
  onExecute?: () => void
  onConfirm?: () => void
  onEdit?: () => void
  onRevoke?: () => void
  onDelete?: () => void
}) {
  const cfg = SANCTION_STATUS_CONFIG[sanction.status]
  const levelRule = resolveSanctionLevel(sanction.level)
  const violation = resolveViolation(sanction.violationCode)
  const needsConfirmation = requiresDualControl(sanction.penalGrade) && !sanction.confirmedAt
  const showActions = canSanction && (onExecute || onConfirm || onEdit || onRevoke || onDelete)

  return (
    <div className={cn('relative flex overflow-hidden rounded-[12px] border', cfg.border, cfg.bg, cfg.glow)}>
      {/* Left accent bar */}
      <div className={cn('w-[3.5px] shrink-0 rounded-l-[12px]', cfg.accent)} />

      <div className="flex-1 min-w-0 p-4">
        {agent && <AgentHeader agent={agent} />}

        {/* Top row: grade + status + measure */}
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-[6px] bg-white/[0.04] px-2.5 py-1">
              <Gavel size={11} className="text-[#f59e0b] shrink-0" strokeWidth={2} />
              <span className="text-[12.5px] font-bold tracking-wide text-[#f4f4f4]">{penalGradeLabel(sanction.penalGrade)}</span>
            </div>
            <span className={cn('rounded-full border px-2.5 py-[2px] text-[10.5px] font-semibold tracking-wide', sanctionStatusClass(sanction.status))}>
              {sanctionStatusLabel(sanction.status)}
            </span>
            {sanction.repeatOfSanctionId && (
              <span className="rounded-full border border-[#7f1d1d]/60 bg-[#2a1212]/60 px-2.5 py-[2px] text-[10.5px] font-semibold text-[#fca5a5]">
                Wiederholungsfall
              </span>
            )}
          </div>
          <div className={cn('flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1', levelBadgeClass(sanction.level))}>
            <span className="text-[10px] font-semibold tabular-nums opacity-70">{sanction.level}</span>
            <span className="text-[12px] font-bold">{levelRule?.measure ?? sanctionLevelLabel(sanction.level)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.05] mb-3" />

        {/* Body: violation, consequence, reason */}
        {violation && (
          <div className="mb-2 flex gap-2">
            <span className="mt-[2px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#f59e0b]" />
            <p className="text-[12.5px] font-medium leading-relaxed text-[#d4d4d4]">Verstoß: {violation.label}</p>
          </div>
        )}
        {sanction.penalty && (
          <div className="mb-2 flex gap-2">
            <span className="mt-[2px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#a1a1a1]" />
            <p className="text-[12.5px] font-medium leading-relaxed text-[#d4d4d4]">Weitere Folge: {sanction.penalty}</p>
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-[#a6a6a6]">{sanction.reason}</p>

        {needsConfirmation && (
          <p className="mt-2.5 flex items-center gap-1.5 rounded-[8px] border border-[#b45309]/40 bg-[#1d1608]/60 px-2.5 py-1.5 text-[11.5px] text-[#fbbf24]">
            <ShieldCheck size={12} strokeWidth={2} />
            Penal Grade {sanction.penalGrade}: Bestätigung einer zweiten Führungskraft steht aus.
          </p>
        )}

        {/* Footer metadata */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] text-[#808080]">{formatDate(sanction.createdAt)}</span>
          <span className="text-[10px] text-[#464646]">·</span>
          <span className="text-[11px] text-[#808080]">{sanction.issuedBy?.displayName ?? 'Gelöscht'}</span>
          <span className="text-[10px] text-[#464646]">·</span>
          <span className="text-[11px] text-[#808080]">{sanctionTimingLabel(sanction)}</span>
          {sanction.confirmedBy && (
            <>
              <span className="text-[10px] text-[#464646]">·</span>
              <span className="flex items-center gap-1 text-[11px] text-[#86efac]">
                <BadgeCheck size={11} strokeWidth={2} /> {sanction.confirmedBy.displayName}
              </span>
            </>
          )}
        </div>

        {/* Action bar */}
        {showActions && (
          <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3.5">
            {variant === 'open' && onConfirm && needsConfirmation && canConfirm && (
              <Button size="sm" onClick={onConfirm}>
                <ShieldCheck size={12} strokeWidth={2.5} /> Bestätigen
              </Button>
            )}
            {variant === 'open' && onExecute && sanction.status === 'ISSUED' && (
              <Button size="sm" onClick={onExecute} disabled={needsConfirmation}>
                <CheckCircle2 size={12} strokeWidth={2.5} /> Maßnahme vollzogen
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <Edit size={12} strokeWidth={1.8} /> Bearbeiten
              </Button>
            )}
            {variant === 'open' && onRevoke && (
              <Button variant="secondary" size="sm" onClick={onRevoke}>
                <Undo2 size={12} strokeWidth={1.8} /> Aufheben
              </Button>
            )}
            {onDelete && (
              <Button variant="danger" size="sm" onClick={onDelete}>
                <Trash2 size={12} strokeWidth={1.8} /> Löschen
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
