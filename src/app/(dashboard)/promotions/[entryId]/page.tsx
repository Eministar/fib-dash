'use client'

import { use, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDownRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  Clock3,
  FilePenLine,
  History,
  MessageSquare,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn, formatDateTime } from '@/lib/utils'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'
import type { RankChangeVoteSummary, RankChangeVoteValue } from '@/lib/rank-change-votes'

type Person = { id: string; displayName: string; discordId: string | null; avatarUrl: string | null }
type Rank = { id: string; name: string; color: string; sortOrder: number }
type Snapshot = {
  proposedRank?: Rank
  newBadgeNumber?: string | null
  note?: string | null
}
type Comment = {
  id: string
  authorId: string | null
  author: Person | null
  content: string
  createdAt: string
  updatedAt: string
}
type Proposal = {
  id: string
  author: Person | null
  baseRevision: number
  beforeState: Snapshot
  afterState: Snapshot
  reason: string | null
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  reviewedBy: Person | null
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
  isStale: boolean
}
type HistoryEntry = {
  id: string
  revision: number
  actor: Person | null
  action: 'CREATED' | 'DIRECT_EDIT' | 'PROPOSAL_ACCEPTED'
  beforeState: Snapshot
  afterState: Snapshot
  createdAt: string
}
type DetailPayload = {
  entry: {
    id: string
    listId: string
    revision: number
    executed: boolean
    executedAt: string | null
    createdAt: string
    updatedAt: string
    newBadgeNumber: string | null
    note: string | null
    list: { id: string; name: string; status: string; submissionsClosed: boolean; createdAt: string }
    agent: {
      id: string
      firstName: string
      lastName: string
      badgeNumber: string
      discordId: string | null
      avatarUrl: string | null
      rank: Rank
    }
    currentRank: Rank
    proposedRank: Rank
    createdBy: Person | null
    executedBy: Person | null
    comments: Comment[]
    proposals: Proposal[]
    history: HistoryEntry[]
    voteSummary: RankChangeVoteSummary
  }
  ranks: Rank[]
  currentUserId: string
  permissions: {
    canEdit: boolean
    canSuggest: boolean
    canReview: boolean
    canComment: boolean
    canModerateComments: boolean
  }
}

type FormMode = 'edit' | 'proposal'
type EntryForm = { proposedRankId: string; newBadgeNumber: string; note: string; reason: string }

function RankTag({ rank }: { rank: Rank }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11.5px] font-semibold"
      style={{ color: rank.color, borderColor: `${rank.color}55`, backgroundColor: `${rank.color}16` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rank.color }} />
      {rank.name}
    </span>
  )
}

function personName(person: Person | null | undefined) {
  return person?.displayName ?? 'Gelöschter Nutzer'
}

function proposalTone(status: Proposal['status'], stale: boolean) {
  if (status === 'ACCEPTED') return { label: 'Angenommen', className: 'bg-[#34d399]/12 text-[#6ee7b7]' }
  if (status === 'REJECTED') return { label: 'Abgelehnt', className: 'bg-[#f87171]/12 text-[#fca5a5]' }
  if (stale) return { label: 'Veraltet', className: 'bg-[#a6a6a6]/12 text-[#c3c3c3]' }
  return { label: 'Offen', className: 'bg-[#fbbf24]/12 text-[#d6d6d6]' }
}

function SnapshotComparison({ before, after }: { before: Snapshot; after: Snapshot }) {
  const oldRank = before.proposedRank
  const newRank = after.proposedRank
  const oldBadge = before.newBadgeNumber ? `#${displayBadgeNumber(before.newBadgeNumber)}` : 'Automatisch'
  const newBadge = after.newBadgeNumber ? `#${displayBadgeNumber(after.newBadgeNumber)}` : 'Automatisch'
  const rows = [
    {
      label: 'Zielrang',
      oldValue: oldRank?.name ?? '—',
      newValue: newRank?.name ?? '—',
      changed: oldRank?.id !== newRank?.id,
    },
    { label: 'Dienstnummer', oldValue: oldBadge, newValue: newBadge, changed: oldBadge !== newBadge },
    { label: 'Begründung', oldValue: before.note || 'Keine', newValue: after.note || 'Keine', changed: before.note !== after.note },
  ]

  return (
    <div className="divide-y divide-[#343434]/45 overflow-hidden rounded-[10px] border border-[#343434]/55 bg-[#161616]/50">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[105px_1fr_18px_1fr] sm:items-center">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#686868]">{row.label}</span>
          <span className={cn('break-words text-[12px]', row.changed ? 'text-[#a6a6a6] line-through decoration-[#f87171]/55' : 'text-[#a6a6a6]')}>
            {row.oldValue}
          </span>
          <ArrowRight size={12} className="hidden text-[#808080] sm:block" />
          <span className={cn('break-words text-[12px] font-medium', row.changed ? 'text-[#f4f4f4]' : 'text-[#a6a6a6]')}>
            {row.newValue}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function RankChangeEntryPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = use(params)
  const { user, loading: authLoading } = useAuth()
  const canView = hasPermission(user, 'rank-changes:view')
  const { data, loading, error: loadError, refetch } = useFetch<DetailPayload>(canView ? `/api/rank-change-entries/${entryId}` : null)
  const { execute, loading: mutating } = useApi()
  const { addToast } = useToast()
  const [formMode, setFormMode] = useState<FormMode | null>(null)
  const [form, setForm] = useState<EntryForm>({ proposedRankId: '', newBadgeNumber: '', note: '', reason: '' })
  const [comment, setComment] = useState('')
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [voting, setVoting] = useState(false)

  const entry = data?.entry
  const direction = entry && entry.proposedRank.sortOrder > entry.currentRank.sortOrder ? 'DEMOTION' : 'PROMOTION'
  const accent = direction === 'DEMOTION' ? '#f87171' : '#34d399'
  const DirectionIcon = direction === 'DEMOTION' ? ArrowDownRight : ArrowUpRight
  const openProposals = useMemo(() => entry?.proposals.filter((item) => item.status === 'PENDING').length ?? 0, [entry?.proposals])

  if (authLoading) return <PageLoader />
  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />
  if (!data || !entry) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <div className="glass-panel-elevated rounded-[14px] p-8 text-center">
          <p className="text-[15px] font-semibold text-white">Eintrag nicht verfügbar</p>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">{loadError ?? 'Die Rangänderung wurde nicht gefunden.'}</p>
          <Link href="/promotions" className="mt-5 inline-flex text-[12.5px] font-medium text-[#d4d4d4] hover:text-[#d6d6d6]">Zurück zur Übersicht</Link>
        </div>
      </div>
    )
  }

  const beginForm = (mode: FormMode) => {
    setForm({
      proposedRankId: entry.proposedRank.id,
      newBadgeNumber: entry.newBadgeNumber ?? '',
      note: entry.note ?? '',
      reason: '',
    })
    setFormMode(mode)
  }

  const submitForm = async () => {
    if (!formMode) return
    try {
      await execute(
        formMode === 'edit' ? `/api/rank-change-entries/${entry.id}` : `/api/rank-change-entries/${entry.id}/proposals`,
        {
          method: formMode === 'edit' ? 'PATCH' : 'POST',
          body: JSON.stringify(form),
        },
      )
      addToast({
        type: 'success',
        title: formMode === 'edit' ? 'Eintrag aktualisiert' : 'Vorschlag eingereicht',
        message: formMode === 'edit' ? 'Die vorige Fassung bleibt im Verlauf sichtbar.' : 'Der Ersteller kann ihn jetzt prüfen.',
      })
      setFormMode(null)
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Änderung fehlgeschlagen', message: cause instanceof Error ? cause.message : undefined })
    }
  }

  const submitComment = async () => {
    if (!comment.trim()) return
    try {
      await execute(`/api/rank-change-entries/${entry.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: comment }),
      })
      setComment('')
      addToast({ type: 'success', title: 'Kommentar hinzugefügt' })
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Kommentar fehlgeschlagen', message: cause instanceof Error ? cause.message : undefined })
    }
  }

  const removeComment = async (commentId: string) => {
    if (!window.confirm('Kommentar wirklich löschen?')) return
    try {
      await execute(`/api/rank-change-entries/${entry.id}/comments/${commentId}`, { method: 'DELETE' })
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: cause instanceof Error ? cause.message : undefined })
    }
  }

  const reviewProposal = async (proposal: Proposal, action: 'ACCEPT' | 'REJECT') => {
    if (action === 'ACCEPT' && !window.confirm('Diesen Vorschlag übernehmen und den Eintrag ändern?')) return
    setReviewingId(proposal.id)
    try {
      await execute(`/api/rank-change-entries/${entry.id}/proposals/${proposal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      addToast({ type: 'success', title: action === 'ACCEPT' ? 'Vorschlag angenommen' : 'Vorschlag abgelehnt' })
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Prüfung fehlgeschlagen', message: cause instanceof Error ? cause.message : undefined })
    } finally {
      setReviewingId(null)
    }
  }

  const vote = async (value: RankChangeVoteValue) => {
    setVoting(true)
    try {
      const nextVote = entry.voteSummary.currentUserVote === value ? null : value
      await execute(`/api/rank-change-lists/${entry.list.id}/entries/${entry.id}/vote`, {
        method: 'PATCH',
        body: JSON.stringify({ vote: nextVote }),
      })
      await refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Abstimmung fehlgeschlagen', message: cause instanceof Error ? cause.message : undefined })
    } finally {
      setVoting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] pb-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/promotions" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#a6a6a6] transition-colors hover:text-white">
          <ArrowLeft size={14} /> Rangänderungen
        </Link>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-[#808080]">Akte · Rev. {entry.revision}</span>
      </div>

      <section className="relative overflow-hidden rounded-[16px] border border-[#404040]/65 bg-[linear-gradient(135deg,rgba(33,33,33,.96),rgba(8,8,8,.96))] p-5 shadow-[0_18px_48px_rgba(0,0,0,.2)] sm:p-6">
        <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <AgentAvatar agent={entry.agent} size="lg" ringColor={entry.proposedRank.color} />
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em]" style={{ color: accent }}>
                  <span className="inline-flex items-center gap-1"><DirectionIcon size={12} /> {direction === 'DEMOTION' ? 'D-Rank' : 'Up-Rank'}</span>
                </span>
                <span className={cn('rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', entry.executed ? 'bg-[#34d399]/12 text-[#6ee7b7]' : 'bg-[#fbbf24]/12 text-[#d6d6d6]')}>
                  {entry.executed ? 'Durchgeführt' : 'Offen'}
                </span>
              </div>
              <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-white sm:text-[25px]">
                {entry.agent.firstName} {entry.agent.lastName}
              </h1>
              <p className="mt-1 text-[12px] text-[#a6a6a6]">
                Dienstnummer #{displayBadgeNumber(entry.agent.badgeNumber)} · Liste „{entry.list.name}“
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <RankTag rank={entry.currentRank} />
                <ArrowRight size={14} className="text-[#686868]" />
                <RankTag rank={entry.proposedRank} />
                {entry.newBadgeNumber && <span className="text-[11px] font-medium text-[#d4d4d4]">neue DN #{displayBadgeNumber(entry.newBadgeNumber)}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="inline-flex items-center gap-1 rounded-[9px] border border-[#404040]/65 bg-[#161616]/55 p-1" role="group" aria-label="Abstimmung zur Rangänderung">
              {([
                ['HIGHER', entry.voteSummary.higherVotes, ArrowUp, 'Höher einstufen', 'bg-[#34d399]/16 text-[#6ee7b7]'],
                ['CONFIRM', entry.voteSummary.confirmVotes, Check, 'Vorschlag bestätigen', 'bg-[#d4d4d4]/16 text-[#d6d6d6]'],
                ['LOWER', entry.voteSummary.lowerVotes, ArrowDown, 'Niedriger einstufen', 'bg-[#f87171]/16 text-[#fca5a5]'],
              ] as const).map(([value, count, Icon, label, activeClassName]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => vote(value)}
                  disabled={voting || entry.executed || entry.list.status === 'COMPLETED'}
                  aria-pressed={entry.voteSummary.currentUserVote === value}
                  aria-label={`${label}: ${count} Stimme${count === 1 ? '' : 'n'}`}
                  title={entry.voteSummary.currentUserVote === value ? `${label} – Stimme entfernen` : label}
                  className={cn(
                    'inline-flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11.5px] font-semibold tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40 disabled:cursor-not-allowed disabled:opacity-40',
                    entry.voteSummary.currentUserVote === value
                      ? activeClassName
                      : 'text-[#a6a6a6] hover:bg-[#333333]/65 hover:text-white',
                  )}
                >
                  <Icon size={13} /> {count}
                </button>
              ))}
            </div>
            {data.permissions.canEdit && (
              <Button variant="secondary" onClick={() => beginForm('edit')}><Pencil size={13} /> Bearbeiten</Button>
            )}
            {data.permissions.canSuggest && (
              <Button variant="secondary" onClick={() => beginForm('proposal')}><FilePenLine size={13} /> Änderung vorschlagen</Button>
            )}
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <main className="space-y-4">
          <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#d4d4d4]/10 text-[#d4d4d4]"><FilePenLine size={14} /></span>
              <h2 className="text-[14px] font-semibold text-white">Begründung</h2>
            </div>
            <p className={cn('whitespace-pre-wrap text-[13px] leading-6', entry.note ? 'text-[#d0d0d0]' : 'italic text-[#686868]')}>
              {entry.note || 'Für diesen Eintrag wurde keine Begründung hinterlegt.'}
            </p>
          </section>

          <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#fbbf24]/10 text-[#d6d6d6]"><FilePenLine size={14} /></span>
                <h2 className="text-[14px] font-semibold text-white">Änderungsvorschläge</h2>
              </div>
              <span className="text-[10.5px] font-medium text-[#a6a6a6]">{openProposals} offen · {entry.proposals.length} gesamt</span>
            </div>
            {entry.proposals.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-[#404040]/55 px-4 py-7 text-center text-[12px] text-[#686868]">Noch keine Änderungsvorschläge.</p>
            ) : (
              <div className="space-y-3">
                {entry.proposals.map((proposal) => {
                  const tone = proposalTone(proposal.status, proposal.isStale)
                  return (
                    <article key={proposal.id} className="rounded-[12px] border border-[#373737]/55 bg-[#191919]/55 p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[12.5px] font-semibold text-[#f4f4f4]">{personName(proposal.author)}</p>
                          <p className="mt-0.5 text-[10.5px] text-[#686868]">{formatDateTime(proposal.createdAt)} · basiert auf Revision {proposal.baseRevision}</p>
                        </div>
                        <span className={cn('rounded-[5px] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide', tone.className)}>{tone.label}</span>
                      </div>
                      {proposal.reason && <p className="mb-3 whitespace-pre-wrap text-[12px] leading-5 text-[#c3c3c3]">{proposal.reason}</p>}
                      <SnapshotComparison before={proposal.beforeState} after={proposal.afterState} />
                      {proposal.reviewedAt && (
                        <p className="mt-3 text-[10.5px] text-[#909090]">
                          Geprüft von {personName(proposal.reviewedBy)} am {formatDateTime(proposal.reviewedAt)}
                          {proposal.reviewNote ? ` · ${proposal.reviewNote}` : ''}
                        </p>
                      )}
                      {proposal.status === 'PENDING' && data.permissions.canReview && (
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="danger" loading={reviewingId === proposal.id && mutating} onClick={() => reviewProposal(proposal, 'REJECT')}>
                            <X size={12} /> Ablehnen
                          </Button>
                          <Button size="sm" disabled={proposal.isStale} loading={reviewingId === proposal.id && mutating} onClick={() => reviewProposal(proposal, 'ACCEPT')}>
                            <Check size={12} /> Annehmen
                          </Button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#38bdf8]/10 text-[#7dd3fc]"><MessageSquare size={14} /></span>
              <h2 className="text-[14px] font-semibold text-white">Kommentare</h2>
              <span className="text-[10.5px] text-[#686868]">{entry.comments.length}</span>
            </div>
            <div className="space-y-3">
              {entry.comments.length === 0 && <p className="py-2 text-[12px] italic text-[#686868]">Noch keine Kommentare.</p>}
              {entry.comments.map((item) => {
                const canDelete = item.authorId === data.currentUserId || data.permissions.canModerateComments
                return (
                  <div key={item.id} className="group flex gap-3 rounded-[10px] border border-[#343434]/45 bg-[#191919]/45 p-3">
                    <span
                      role="img"
                      aria-label={`Discord-Profilbild von ${personName(item.author)}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#808080]/60 bg-[#333333]/65 bg-cover bg-center text-[#a6a6a6]"
                      style={{ backgroundImage: item.author?.avatarUrl ? `url(${item.author.avatarUrl})` : undefined }}
                    >
                      {!item.author?.avatarUrl && <UserRound size={14} aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11.5px] font-semibold text-[#f4f4f4]">{personName(item.author)}</p>
                        <div className="flex items-center gap-1.5">
                          <time className="text-[10px] text-[#686868]">{formatDateTime(item.createdAt)}</time>
                          {canDelete && (
                            <button onClick={() => removeComment(item.id)} className="rounded-[5px] p-1 text-[#808080] opacity-0 transition-all hover:bg-[#321218]/60 hover:text-[#fca5a5] group-hover:opacity-100 focus-visible:opacity-100" aria-label="Kommentar löschen">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-5 text-[#c3c3c3]">{item.content}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            {data.permissions.canComment && (
              <div className="mt-4 border-t border-[#343434]/45 pt-4">
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Kommentar zur Rangänderung …" rows={3} maxLength={2000} />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] tabular-nums text-[#808080]">{comment.length}/2000</span>
                  <Button size="sm" loading={mutating} disabled={!comment.trim()} onClick={submitComment}><Send size={12} /> Kommentieren</Button>
                </div>
              </div>
            )}
          </section>

          <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#a6a6a6]/10 text-[#c3c3c3]"><History size={14} /></span>
              <h2 className="text-[14px] font-semibold text-white">Versionsverlauf</h2>
            </div>
            <div className="space-y-3">
              {entry.history.map((record) => (
                <article key={record.id} className="relative border-l border-[#404040]/65 pl-4">
                  <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border border-[#d4d4d4]/60 bg-[#181818]" />
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11.5px] font-semibold text-[#f4f4f4]">
                        {record.action === 'CREATED' ? 'Eintrag erstellt' : record.action === 'PROPOSAL_ACCEPTED' ? 'Vorschlag übernommen' : 'Direkt bearbeitet'}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#686868]">Revision {record.revision} · {personName(record.actor)} · {formatDateTime(record.createdAt)}</p>
                    </div>
                  </div>
                  {record.action !== 'CREATED' && <SnapshotComparison before={record.beforeState} after={record.afterState} />}
                </article>
              ))}
              {entry.history.length === 0 && (
                <p className="text-[12px] text-[#686868]">Dieser ältere Eintrag besitzt noch keinen protokollierten Versionsstand.</p>
              )}
            </div>
          </section>
        </main>

        <aside className="space-y-4">
          <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-[#686868]">Akteninformationen</p>
            <dl className="space-y-3">
              <div className="flex items-start gap-2.5">
                <UserRound size={14} className="mt-0.5 text-[#d4d4d4]" />
                <div><dt className="text-[10px] text-[#686868]">Eingereicht von</dt><dd className="text-[12px] font-medium text-[#f4f4f4]">{personName(entry.createdBy)}</dd></div>
              </div>
              <div className="flex items-start gap-2.5">
                <Clock3 size={14} className="mt-0.5 text-[#d4d4d4]" />
                <div><dt className="text-[10px] text-[#686868]">Eingereicht am</dt><dd className="text-[12px] font-medium text-[#f4f4f4]">{formatDateTime(entry.createdAt)}</dd></div>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={14} className="mt-0.5 text-[#d4d4d4]" />
                <div><dt className="text-[10px] text-[#686868]">Freigabe</dt><dd className="text-[12px] font-medium text-[#f4f4f4]">{entry.executed ? `Durchgeführt von ${personName(entry.executedBy)}` : 'Noch nicht durchgeführt'}</dd></div>
              </div>
            </dl>
          </section>
          <section className="rounded-[14px] border border-[#d4d4d4]/20 bg-[#d4d4d4]/[0.055] p-4">
            <p className="text-[11.5px] font-semibold text-[#d6d6d6]">Wer darf was?</p>
            <p className="mt-1.5 text-[11px] leading-5 text-[#a6a6a6]">
              Der Ersteller und Nutzer mit Vollzugriff dürfen direkt bearbeiten und Vorschläge prüfen. Alle anderen reichen Änderungen zur Freigabe ein.
            </p>
          </section>
        </aside>
      </div>

      <Modal
        open={Boolean(formMode)}
        onClose={() => setFormMode(null)}
        title={formMode === 'edit' ? 'Eintrag bearbeiten' : 'Änderung vorschlagen'}
        description={formMode === 'edit' ? 'Die vorige Fassung bleibt im Versionsverlauf erhalten.' : 'Der Ersteller oder eine berechtigte Person prüft deinen Vorschlag.'}
        size="lg"
      >
        <div className="space-y-4">
          <Select
            label="Vorgeschlagener Rang"
            value={form.proposedRankId}
            onValueChange={(value) => setForm((current) => ({ ...current, proposedRankId: value }))}
            options={data.ranks.map((rank) => ({ value: rank.id, label: rank.name }))}
          />
          <Input
            label="Neue Dienstnummer (optional)"
            numericOnly
            value={form.newBadgeNumber}
            onChange={(event) => setForm((current) => ({ ...current, newBadgeNumber: event.target.value }))}
            placeholder="Leer lassen für automatische Vergabe"
          />
          <Textarea
            label="Begründung im Eintrag"
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            rows={4}
            maxLength={5000}
            placeholder="Warum soll diese Rangänderung erfolgen?"
          />
          {formMode === 'proposal' && (
            <Textarea
              label="Warum schlägst du diese Änderung vor?"
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              rows={3}
              maxLength={2000}
              placeholder="Kurzer Hinweis für die prüfende Person"
            />
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setFormMode(null)}>Abbrechen</Button>
            <Button loading={mutating} disabled={!form.proposedRankId} onClick={submitForm}>
              {formMode === 'edit' ? <><Check size={13} /> Speichern</> : <><Send size={13} /> Vorschlag senden</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
