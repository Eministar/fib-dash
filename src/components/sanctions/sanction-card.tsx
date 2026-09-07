'use client'

import Link from 'next/link'
import { Check, Edit, Gavel, Trash2, TrendingUp, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { displayBadgeNumber } from '@/lib/badge-number'
import { normalizeSanctionMeasureType, penalGradeLabel } from '@/lib/sanction-catalog'
import { cn, formatDate, formatDateTime } from '@/lib/utils'

export interface SanctionRecord {
  id: string
  reason: string
  penalGrade: string
  measureType?: string | null
  fineAmount: number | null
  sgRounds?: number | null
  penalty: string | null
  status: 'OPEN' | 'PAID' | 'ESCALATED' | 'IN_COURT'
  dueAt: string | null
  paidAt: string | null
  escalatedAt: string | null
  parentSanctionId: string | null
  createdAt: string
  updatedAt: string
  issuedBy: { displayName: string } | null
}

/** Agent-Kopfzeile — nur auf Übersichtsseiten nötig, die mehrere Agents mischen. */
export interface SanctionCardAgent {
  id: string | null
  firstName: string
  lastName: string
  badgeNumber: string | null
  rankName: string | null
}

export function sanctionStatusLabel(status: SanctionRecord['status']) {
  if (status === 'PAID') return 'Bezahlt'
  if (status === 'ESCALATED') return 'Nicht bezahlt / verdoppelt'
  if (status === 'IN_COURT') return 'In Klage'
  return 'Offen'
}

export function sanctionStatusClass(status: SanctionRecord['status']) {
  if (status === 'PAID') return 'border-[#166534]/60 bg-[#052e1a]/60 text-[#86efac]'
  if (status === 'ESCALATED') return 'border-[#7f1d1d]/60 bg-[#2a1212]/60 text-[#fca5a5]'
  if (status === 'IN_COURT') return 'border-[#6d28d9]/60 bg-[#1a1030]/60 text-[#c4b5fd]'
  return 'border-[#b45309]/50 bg-[#1d1608]/70 text-[#fbbf24]'
}

export function sanctionDueLabel(sanction: SanctionRecord) {
  if (sanction.status === 'PAID' && sanction.paidAt) return `Bezahlt am ${formatDateTime(sanction.paidAt)}`
  if (sanction.status === 'ESCALATED' && sanction.escalatedAt) return `Verdoppelt am ${formatDateTime(sanction.escalatedAt)}`
  if (!sanction.dueAt) return 'Keine Frist'
  return `Frist bis ${formatDateTime(sanction.dueAt)}`
}

const SANCTION_STATUS_CONFIG = {
  OPEN: {
    accent: 'bg-[#d97706]',
    glow: 'shadow-[0_0_0_1px_rgba(217,119,6,0.2)]',
    border: 'border-[#d97706]/25',
    bg: 'bg-[#0d0a02]',
  },
  PAID: {
    accent: 'bg-[#16a34a]',
    glow: 'shadow-[0_0_0_1px_rgba(22,163,74,0.15)]',
    border: 'border-[#16a34a]/20',
    bg: 'bg-[#020d04]',
  },
  ESCALATED: {
    accent: 'bg-[#dc2626]',
    glow: 'shadow-[0_0_0_1px_rgba(220,38,38,0.2)]',
    border: 'border-[#dc2626]/25',
    bg: 'bg-[#0d0202]',
  },
  IN_COURT: {
    accent: 'bg-[#8b5cf6]',
    glow: 'shadow-[0_0_0_1px_rgba(139,92,246,0.2)]',
    border: 'border-[#8b5cf6]/25',
    bg: 'bg-[#0a0616]',
  },
} as const

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
  variant,
  agent,
  onPaid,
  onEdit,
  onEscalate,
  onDelete,
}: {
  sanction: SanctionRecord
  canSanction: boolean
  variant: 'open' | 'history'
  /** Wenn gesetzt, zeigt die Karte, wen die Sanktion betrifft. */
  agent?: SanctionCardAgent
  onPaid?: () => void
  onEdit?: () => void
  onEscalate?: () => void
  onDelete?: () => void
}) {
  const cfg = SANCTION_STATUS_CONFIG[sanction.status]
  const measureType = normalizeSanctionMeasureType(sanction.measureType)
  const showActions = canSanction && (onPaid || onEdit || onEscalate || onDelete)

  return (
    <div className={cn('relative flex overflow-hidden rounded-[12px] border', cfg.border, cfg.bg, cfg.glow)}>
      {/* Left accent bar */}
      <div className={cn('w-[3.5px] shrink-0 rounded-l-[12px]', cfg.accent)} />

      <div className="flex-1 min-w-0 p-4">
        {agent && <AgentHeader agent={agent} />}

        {/* Top row: grade + status + amount */}
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-[6px] bg-white/[0.04] px-2.5 py-1">
              <Gavel size={11} className="text-[#f59e0b] shrink-0" strokeWidth={2} />
              <span className="text-[12.5px] font-bold tracking-wide text-[#f4f4f4]">{penalGradeLabel(sanction.penalGrade)}</span>
            </div>
            <span className={cn('rounded-full border px-2.5 py-[2px] text-[10.5px] font-semibold tracking-wide', sanctionStatusClass(sanction.status))}>
              {sanctionStatusLabel(sanction.status)}
            </span>
          </div>
          {measureType === 'SG_ROUNDS' ? (
            <div className="flex items-baseline gap-1 rounded-[6px] border border-[#38bdf8]/20 bg-[#38bdf8]/10 px-2.5 py-1">
              <span className="text-[13px] font-bold tabular-nums text-[#7dd3fc]">{sanction.sgRounds ?? '—'}</span>
              <span className="text-[10px] font-medium text-[#67b9df]">SG-Runden</span>
            </div>
          ) : sanction.fineAmount !== null && sanction.fineAmount > 0 && (
            <div className="flex items-baseline gap-1 rounded-[6px] bg-[#d4d4d4]/10 border border-[#d4d4d4]/20 px-2.5 py-1">
              <span className="text-[13px] font-bold tabular-nums text-[#d4d4d4]">
                {new Intl.NumberFormat('de-DE').format(sanction.fineAmount)}
              </span>
              <span className="text-[10px] font-medium text-[#b8973a]">$</span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/[0.05] mb-3" />

        {/* Body: grade consequence + reason */}
        {sanction.penalty && (
          <div className="mb-2 flex gap-2">
            <span className="mt-[2px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#a1a1a1]" />
            <p className="text-[12.5px] font-medium text-[#d4d4d4] leading-relaxed">Grade-Folge: {sanction.penalty}</p>
          </div>
        )}
        <p className="text-[12.5px] leading-relaxed text-[#a6a6a6]">{sanction.reason}</p>

        {/* Footer metadata */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] text-[#808080]">{formatDate(sanction.createdAt)}</span>
          <span className="text-[10px] text-[#464646]">·</span>
          <span className="text-[11px] text-[#808080]">{sanction.issuedBy?.displayName ?? 'Gelöscht'}</span>
          <span className="text-[10px] text-[#464646]">·</span>
          <span className="text-[11px] text-[#808080]">{sanctionDueLabel(sanction)}</span>
        </div>

        {/* Action bar */}
        {showActions && (
          <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3.5">
            {variant === 'open' && onPaid && (
              <Button size="sm" onClick={onPaid}>
                <Check size={12} strokeWidth={2.5} /> {measureType === 'SG_ROUNDS' ? 'Als erledigt markieren' : 'Als bezahlt markieren'}
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit}>
                <Edit size={12} strokeWidth={1.8} /> Bearbeiten
              </Button>
            )}
            {variant === 'open' && onEscalate && (
              <Button variant="secondary" size="sm" onClick={onEscalate}>
                <TrendingUp size={12} strokeWidth={1.8} /> Verdoppeln
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
