'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, Lock, LockOpen, MessageSquare, Play, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import { cn, formatDate } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import type { RankChangeVoteSummary, RankChangeVoteValue } from '@/lib/rank-change-votes'

export type RankChangeDirection = 'PROMOTION' | 'DEMOTION'

export interface RankChangeEntry {
    id: string
    agent: { id: string; firstName: string; lastName: string; badgeNumber: string; discordId: string | null; avatarUrl: string | null }
    currentRank: { id: string; name: string; color: string; sortOrder: number }
    proposedRank: { id: string; name: string; color: string; sortOrder: number }
    newBadgeNumber: string | null
    note: string | null
    executed: boolean
    executedAt: string | null
    createdBy: { id: string; displayName: string } | null
    executedBy: { id: string; displayName: string } | null
    voteSummary: RankChangeVoteSummary
    commentCount: number
}

export interface RankChangeList {
    id: string
    name: string
    description: string | null
    type: string
    status: string
    submissionsClosed: boolean
    closedAt: string | null
    createdBy: { displayName: string } | null
    createdAt: string
    entries: RankChangeEntry[]
}

/** Kleinerer sortOrder = höherer Rang, also ist ein Aufstieg eine Beförderung. */
export function entryDirection(entry: Pick<RankChangeEntry, 'currentRank' | 'proposedRank'>): RankChangeDirection {
    return entry.proposedRank.sortOrder > entry.currentRank.sortOrder ? 'DEMOTION' : 'PROMOTION'
}

/** Sortiert nach Zielrang (höchster zuerst), dann aktueller Rang, dann Nachname. */
export function sortEntriesByRank<T extends Pick<RankChangeEntry, 'currentRank' | 'proposedRank' | 'agent'>>(entries: T[]): T[] {
    return [...entries].sort((a, b) => (
        a.proposedRank.sortOrder - b.proposedRank.sortOrder
        || a.currentRank.sortOrder - b.currentRank.sortOrder
        || a.agent.lastName.localeCompare(b.agent.lastName, 'de')
    ))
}

export const DIRECTION_ACCENT: Record<RankChangeDirection, string> = {
    PROMOTION: '#34d399',
    DEMOTION: '#f87171',
}

export const DIRECTION_LABEL: Record<RankChangeDirection, string> = {
    PROMOTION: 'Up-Rank',
    DEMOTION: 'D-Rank',
}

function RankPill({ name, color }: { name: string; color: string }) {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ borderColor: `${color}55`, backgroundColor: `${color}18`, color }}
        >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
            {name}
    </span>
    )
}

function DirectionPill({ direction }: { direction: RankChangeDirection }) {
    const accent = DIRECTION_ACCENT[direction]
    const Icon = direction === 'PROMOTION' ? ArrowUpRight : ArrowDownRight
    return (
        <span
            className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
            style={{ borderColor: `${accent}40`, backgroundColor: `${accent}18`, color: accent }}
        >
            <Icon size={11} strokeWidth={2.5} />
            {DIRECTION_LABEL[direction]}
        </span>
    )
}

function EntryVoteControls({
                               summary,
                               disabled,
                               loading,
                               onVote,
                           }: {
    summary: RankChangeVoteSummary
    disabled: boolean
    loading: boolean
    onVote: (vote: RankChangeVoteValue) => void
}) {
    const buttons: {
        vote: RankChangeVoteValue
        count: number
        label: string
        icon: typeof ArrowUp
        activeClassName: string
    }[] = [
        { vote: 'HIGHER', count: summary.higherVotes, label: 'Höher einstufen', icon: ArrowUp, activeClassName: 'bg-[#34d399]/18 text-[#6ee7b7]' },
        { vote: 'CONFIRM', count: summary.confirmVotes, label: 'Vorschlag bestätigen', icon: Check, activeClassName: 'bg-[#d4d4d4]/18 text-[#d6d6d6]' },
        { vote: 'LOWER', count: summary.lowerVotes, label: 'Niedriger einstufen', icon: ArrowDown, activeClassName: 'bg-[#f87171]/18 text-[#fca5a5]' },
    ]

    return (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-[#373737]/55 bg-[#191919]/70 p-1" role="group" aria-label="Abstimmung zur Rangänderung">
            {buttons.map(({ vote, count, label, icon: Icon, activeClassName }) => {
                const active = summary.currentUserVote === vote
                return (
                    <button
                        key={vote}
                        type="button"
                        onClick={() => onVote(vote)}
                        disabled={disabled || loading}
                        aria-pressed={active}
                        aria-label={`${label}: ${count} Stimme${count === 1 ? '' : 'n'}`}
                        title={active ? `${label} – Stimme entfernen` : label}
                        className={cn(
                            'inline-flex h-7 min-w-10 items-center justify-center gap-1 rounded-[6px] px-2 text-[11.5px] font-semibold tabular-nums transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40 disabled:cursor-not-allowed disabled:opacity-55',
                            active && activeClassName,
                            !active && 'text-[#909090] hover:bg-[#333333]/70 hover:text-white',
                        )}
                    >
                        <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                        {count}
                    </button>
                )
            })}
        </div>
    )
}

interface RankChangeListCardProps {
    list: RankChangeList
    /** Bereits gefilterte und sortierte Einträge; leer = kein Treffer im aktiven Filter. */
    entries: RankChangeEntry[]
    /** true, wenn Suche/Filter aktiv sind — steuert den Leertext. */
    filtered: boolean
    expanded: boolean
    onToggle: () => void
    canExecute: boolean
    canManage: boolean
    onExecute: (entry: RankChangeEntry) => void
    onUndo: (entry: RankChangeEntry) => void
    onRemove: (entryId: string) => void
    onAddEntry: () => void
    onToggleSubmissions: () => void
    onDelete: () => void
    canDelete: boolean
    onVote: (entry: RankChangeEntry, vote: RankChangeVoteValue) => void
    votingEntryIds: ReadonlySet<string>
    footerActions?: ReactNode
}

export function RankChangeListCard({
                                       list, entries, filtered, expanded, onToggle, canExecute, canManage, onExecute, onUndo, onRemove, onAddEntry, onToggleSubmissions, onDelete, canDelete, onVote, votingEntryIds,
                                   }: RankChangeListCardProps) {
    const total = list.entries.length
    const executed = list.entries.filter((e) => e.executed).length
    const pending = total - executed
    const promotions = list.entries.filter((e) => entryDirection(e) === 'PROMOTION').length
    const demotions = total - promotions
    const isCompleted = list.status === 'COMPLETED'
    const isClosed = list.submissionsClosed
    const canAddEntries = !isCompleted && !isClosed
    const progress = total > 0 ? Math.round((executed / total) * 100) : 0
    const accent = isCompleted ? '#a6a6a6' : '#d4d4d4'

    const statusLabel = isCompleted ? 'Abgeschlossen' : isClosed ? 'Geschlossen' : 'Offen'
    const statusTone = isCompleted
        ? 'bg-[#34d399]/14 text-[#34d399]'
        : isClosed
            ? 'bg-[#a6a6a6]/14 text-[#c3c3c3]'
            : 'bg-[#fbbf24]/14 text-[#fbbf24]'
    const statusDot = isCompleted ? 'bg-[#34d399]' : isClosed ? 'bg-[#c3c3c3]' : 'bg-[#fbbf24]'

    return (
        <div className="glass-panel-elevated rounded-[14px] overflow-hidden border border-[#373737]/45 transition-colors hover:border-[#404040]">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3.5 px-5 py-4 hover:bg-[#212121]/60 transition-colors text-left"
            >
                <ChevronDown size={14} strokeWidth={2.5} className={cn('text-[#808080] transition-transform duration-200 shrink-0', !expanded && '-rotate-90')} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-white">{list.name}</span>
                        {promotions > 0 && (
                            <span
                                className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
                                style={{ borderColor: '#34d39940', backgroundColor: '#34d39918', color: '#34d399' }}
                            >
                                <ArrowUpRight size={11} strokeWidth={2.5} />
                                {promotions} Up-Rank
                            </span>
                        )}
                        {demotions > 0 && (
                            <span
                                className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
                                style={{ borderColor: '#f8717140', backgroundColor: '#f8717118', color: '#f87171' }}
                            >
                                <ArrowDownRight size={11} strokeWidth={2.5} />
                                {demotions} D-Rank
                            </span>
                        )}
                        <span className={cn('inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide', statusTone)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
                            {statusLabel}
                        </span>
                    </div>
                    <p className="text-[11.5px] text-[#a6a6a6] mt-1">
                        {formatDate(list.createdAt)} · {list.createdBy?.displayName ?? 'Gelöscht'}
                        {list.description && <span className="text-[#686868]"> · {list.description}</span>}
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {total > 0 && (
                        <div className="hidden sm:flex flex-col items-end gap-1">
                            <div className="flex items-center gap-2 text-[10.5px] text-[#a6a6a6]">
                                <span><span className="font-semibold text-white">{executed}</span>/{total} durchgeführt</span>
                            </div>
                            <div className="h-1 w-24 rounded-full bg-[#212121] overflow-hidden">
                                <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: accent }} />
                            </div>
                        </div>
                    )}
                    {pending > 0 && !isCompleted && (
                        <span className="text-[10.5px] font-semibold text-[#fbbf24] bg-[#fbbf24]/12 px-2 py-1 rounded-[6px]">
              {pending} offen
            </span>
                    )}
                </div>
            </button>

            {expanded && (
                <div className="px-5 pb-4 border-t border-[#343434]/40">
                    {entries.length > 0 ? (
                        <div className="space-y-1.5 my-3">
                            {entries.map((entry) => {
                                const direction = entryDirection(entry)
                                return (
                                    <div
                                        key={entry.id}
                                        className={cn(
                                            'flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-[10px] border transition-colors',
                                            entry.executed
                                                ? 'bg-[#1c1c1c]/60 border-[#343434]/30 opacity-80'
                                                : 'bg-[#212121]/70 border-[#373737]/40 hover:border-[#404040]',
                                        )}
                                    >
                                        <AgentAvatar agent={entry.agent} ringColor={entry.proposedRank.color} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <Link href={`/agents/${entry.agent.id}`} className="text-[13px] font-medium text-white hover:text-[#d4d4d4] transition-colors">
                                                    {entry.agent.firstName} {entry.agent.lastName}
                                                </Link>
                                                <span className="text-[11px] text-[#a6a6a6]">#{displayBadgeNumber(entry.agent.badgeNumber)}</span>
                                                {entry.newBadgeNumber && (
                                                    <span className="text-[10.5px] text-[#a6a6a6]">
                          → <span className="text-[#d4d4d4]">#{displayBadgeNumber(entry.newBadgeNumber)}</span>
                        </span>
                                                )}
                                                <DirectionPill direction={direction} />
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <RankPill name={entry.currentRank.name} color={entry.currentRank.color} />
                                                <ArrowRight size={11} className="text-[#686868]" />
                                                <RankPill name={entry.proposedRank.name} color={entry.proposedRank.color} />
                                            </div>
                                            {entry.note && (
                                                <p className="text-[11px] text-[#c3c3c3] mt-1.5 italic">„{entry.note}“</p>
                                            )}
                                            <p className="text-[10.5px] text-[#686868] mt-1">
                                                Eingereicht von <span className="text-[#909090]">{entry.createdBy?.displayName ?? list.createdBy?.displayName ?? 'Gelöscht'}</span>
                                                {entry.executed && (
                                                    <>
                                                        {' · '}Durchgeführt
                                                        {entry.executedAt && <> am {formatDate(entry.executedAt)}</>}
                                                        {' von '}
                                                        <span className="text-[#909090]">{entry.executedBy?.displayName ?? 'Unbekannt'}</span>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <div className="ml-auto flex shrink-0 items-center gap-2">
                                            <Link
                                                href={`/promotions/${entry.id}`}
                                                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#404040]/70 bg-[#232323]/70 px-2.5 text-[11.5px] font-medium text-[#c3c3c3] transition-colors hover:border-[#d4d4d4]/45 hover:text-[#d6d6d6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40"
                                                title="Eintrag, Kommentare und Vorschläge öffnen"
                                            >
                                                Details
                                                <span className="inline-flex items-center gap-1 rounded-[5px] bg-[#161616]/65 px-1.5 py-0.5 text-[10.5px] tabular-nums text-[#a6a6a6]">
                                                    <MessageSquare size={11} /> {entry.commentCount}
                                                </span>
                                                <ChevronRight size={13} />
                                            </Link>
                                            <EntryVoteControls
                                                summary={entry.voteSummary}
                                                disabled={entry.executed || isCompleted}
                                                loading={votingEntryIds.has(entry.id)}
                                                onVote={(vote) => onVote(entry, vote)}
                                            />
                                            {entry.executed ? (
                                                <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#34d399] bg-[#34d399]/12 px-2 py-1 rounded-[6px]">
                        ✓ Durchgeführt
                      </span>
                                                    {canExecute && direction === 'PROMOTION' && (
                                                        <Button variant="secondary" size="sm" onClick={() => onUndo(entry)}>
                                                            <Undo2 size={12} /> Rückgängig
                                                        </Button>
                                                    )}
                                                </div>
                                            ) : canExecute ? (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <Button size="sm" variant={direction === 'DEMOTION' ? 'danger' : 'primary'} onClick={() => onExecute(entry)}>
                                                        <Play size={12} /> Durchführen
                                                    </Button>
                                                    {canManage && (
                                                        <button
                                                            onClick={() => onRemove(entry.id)}
                                                            className="p-1.5 rounded-[6px] hover:bg-[#321218]/60 text-[#686868] hover:text-[#fca5a5] transition-colors"
                                                            title="Entfernen"
                                                        >
                                                            <X size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="text-[12px] text-[#686868] italic py-3">
                            {filtered ? 'Keine Einträge passen zu Suche und Filter' : 'Noch keine Agents in dieser Liste'}
                        </p>
                    )}

                    {(canManage || canDelete) && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            {canManage && canAddEntries && (
                                <Button variant="secondary" size="sm" onClick={onAddEntry}>
                                    + Agent hinzufügen
                                </Button>
                            )}
                            {canManage && !isCompleted && (
                                <Button variant="secondary" size="sm" onClick={onToggleSubmissions}>
                                    {isClosed ? <><LockOpen size={12} /> Einreichungen öffnen</> : <><Lock size={12} /> Einreichungen schließen</>}
                                </Button>
                            )}
                            {canDelete && (
                                <Button variant="danger" size="sm" onClick={onDelete}>
                                    Liste löschen
                                </Button>
                            )}
                        </div>
                    )}
                    {isClosed && !isCompleted && (
                        <p className="text-[11px] text-[#a6a6a6] pt-2">
                            Einreichungen geschlossen{list.closedAt ? ` am ${formatDate(list.closedAt)}` : ''} — offene Einträge können weiterhin durchgeführt werden.
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
