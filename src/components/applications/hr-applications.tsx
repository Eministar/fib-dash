'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ClipboardList, FileText, MessageSquareText, RefreshCw, Save, Search, UserRound, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useToast } from '@/components/ui/toast'
import { cn, formatDateTime } from '@/lib/utils'
import { stripApplicationCaseNumber } from '@/lib/application-case-number'
import {
  JOB_APPLICATION_STATUSES,
  JOB_APPLICATION_STATUS_META,
  applicationAnswerText,
  type JobApplicationStatusValue,
} from '@/lib/job-applications'

interface ApplicationAnswer {
  id: string
  questionId: string
  questionTitle: string
  questionType: string
  value: Record<string, unknown>
  sortOrder: number
}

interface ApplicationRow {
  id: string
  caseNumber: string | null
  applicantId: string
  discordId: string
  discordUsername: string | null
  discordGlobalName: string | null
  discordAvatar: string | null
  applicantDisplayName: string
  status: JobApplicationStatusValue
  statusText: string
  internalNote: string | null
  submittedAt: string
  reviewedAt: string | null
  updatedAt: string
  reviewedBy: { id: string; displayName: string } | null
  answers: ApplicationAnswer[]
  applicant: { id: string; displayName: string; username: string; discordId: string | null }
}

interface HrApplicationsProps {
  canManage: boolean
}

const statusOptions = JOB_APPLICATION_STATUSES.map((status) => ({
  value: status,
  label: JOB_APPLICATION_STATUS_META[status].label,
}))

/** „Offen“ = noch keine Entscheidung gefallen. */
const OPEN_STATUSES: JobApplicationStatusValue[] = ['SUBMITTED', 'IN_REVIEW', 'HR_INTERVIEW']

type StatusFilter = 'ALL' | 'OPEN' | JobApplicationStatusValue

const filterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'OPEN', label: 'Offen' },
  { value: 'ALL', label: 'Alle' },
  ...JOB_APPLICATION_STATUSES.map((status) => ({
    value: status as StatusFilter,
    label: JOB_APPLICATION_STATUS_META[status].shortLabel,
  })),
]

function matchesStatusFilter(application: ApplicationRow, filter: StatusFilter) {
  if (filter === 'ALL') return true
  if (filter === 'OPEN') return OPEN_STATUSES.includes(application.status)
  return application.status === filter
}

/** Durchsuchbar über Aktenzeichen, Name und Discord-Kennungen. */
function applicationHaystack(application: ApplicationRow) {
  return [
    application.caseNumber,
    application.applicantDisplayName,
    application.discordId,
    application.discordUsername,
    application.discordGlobalName,
    application.applicant?.username,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function discordAvatarUrl(application: Pick<ApplicationRow, 'discordId' | 'discordAvatar'>) {
  if (!application.discordId || !application.discordAvatar) return null
  const ext = application.discordAvatar.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${application.discordId}/${application.discordAvatar}.${ext}?size=96`
}

export function HrApplications({ canManage }: HrApplicationsProps) {
  const { data: applications, loading, error, refetch } = useFetch<ApplicationRow[]>('/api/applications')
  const { data: nicknameQueue, refetch: refetchPending } = useFetch<{ total: number; pending: number }>(
    canManage ? '/api/applications/sync-nicknames' : null,
  )
  const { execute } = useApi()
  const { addToast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<JobApplicationStatusValue>('SUBMITTED')
  const [statusText, setStatusText] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; remaining: number } | null>(null)
  // Merkt sich die zuletzt in die Editierfelder geladene Bewerbung. Der stille
  // Live-Refetch (useFetch) liefert `selected` als NEUES Objekt mit gleicher id —
  // ohne diesen Ref würden Status-Text/interne Notiz bei jedem Refetch aus den
  // Serverdaten überschrieben und laufende Eingaben gingen verloren.
  const loadedApplicationIdRef = useRef<string | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (applications ?? []).filter((application) => (
      matchesStatusFilter(application, statusFilter) &&
      (!query || applicationHaystack(application).includes(query))
    ))
  }, [applications, search, statusFilter])

  // Die Auswahl folgt der gefilterten Liste — sonst zeigt das Detail eine
  // Bewerbung, die links gar nicht mehr sichtbar ist.
  const selected = useMemo(() => filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null, [filtered, selectedId])

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  useEffect(() => {
    if (!selected) {
      loadedApplicationIdRef.current = null
      setStatus('SUBMITTED')
      setStatusText('')
      setInternalNote('')
      return
    }
    // Nur beim WECHSEL der Bewerbung seeden, nicht bei jedem Live-Refetch derselben.
    if (loadedApplicationIdRef.current === selected.id) return
    loadedApplicationIdRef.current = selected.id
    setStatus(selected.status)
    setStatusText(selected.statusText)
    setInternalNote(selected.internalNote ?? '')
  }, [selected])

  const stats = useMemo(() => {
    const list = applications ?? []
    return {
      total: list.length,
      open: list.filter((item) => item.status === 'SUBMITTED' || item.status === 'IN_REVIEW').length,
      interviews: list.filter((item) => item.status === 'HR_INTERVIEW').length,
      accepted: list.filter((item) => item.status === 'ACCEPTED').length,
      rejected: list.filter((item) => item.status === 'REJECTED').length,
    }
  }, [applications])

  /**
   * Setzt Anzeigename und Discord-Nickname neu. Nötig für Bewerbungen, deren
   * Aktenzeichen nachträglich vergeben wurde — das Wartungsskript fasst Discord
   * bewusst nicht an.
   */
  const syncNickname = async () => {
    if (!selected) return
    setSyncing(true)
    try {
      const result = await execute(
        `/api/applications/${selected.id}/sync-nickname`,
        { method: 'POST' },
      ) as { displayName: string; nickname: string; message: string } | null
      addToast({
        type: result?.nickname === 'synced' ? 'success' : 'warning',
        title: result?.displayName ?? 'Name aktualisiert',
        message: result?.message ?? '',
      })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Umbenennen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSyncing(false)
    }
  }

  /**
   * Benennt ALLE Bewerber um. Der Server arbeitet in Häppchen (Discord
   * limitiert Nickname-Änderungen), deshalb wird hier so lange nachgefasst, bis
   * nichts mehr offen ist.
   */
  const syncAllNicknames = async (force = false) => {
    const question = force
      ? 'Wirklich ALLE Bewerber erneut umbenennen — auch die, die schon dran waren?'
      : 'Alle Bewerber auf „Aktenzeichen | Name“ umbenennen? Das ändert auch die Discord-Nicknames.'
    if (!confirm(question)) return

    setSyncing(true)
    const totals: Record<string, number> = {}
    let processed = 0

    try {
      // Sicherheitsnetz gegen eine Endlosschleife, falls der Server wider
      // Erwarten nie auf 0 herunterzählt.
      for (let round = 0; round < 200; round += 1) {
        const result = await execute('/api/applications/sync-nicknames', {
          method: 'POST',
          body: JSON.stringify({ force: force && round === 0 }),
        }) as { processed: number; remaining: number; counts: Record<string, number> } | null

        if (!result) break
        processed += result.processed
        for (const [key, value] of Object.entries(result.counts)) {
          totals[key] = (totals[key] ?? 0) + value
        }

        setSyncProgress({ done: processed, remaining: result.remaining })
        if (result.remaining === 0 || result.processed === 0) break
      }

      addToast({
        type: 'success',
        title: `${totals.synced ?? 0} von ${processed} Bewerbern umbenannt`,
        message: [
          totals['missing-permissions'] ? `${totals['missing-permissions']}× Bot-Rolle zu niedrig` : '',
          totals['not-member'] ? `${totals['not-member']}× nicht auf dem Server` : '',
          totals.skipped ? `${totals.skipped}× ohne Discord-ID` : '',
          totals.failed ? `${totals.failed}× von Discord abgelehnt` : '',
        ].filter(Boolean).join(' · ') || 'Alle Bewerber sind auf dem aktuellen Stand.',
      })
      await Promise.all([refetch(), refetchPending()])
    } catch (e) {
      addToast({ type: 'error', title: 'Umbenennen fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSyncing(false)
      setSyncProgress(null)
    }
  }

  const updateApplication = async (patch?: Partial<Pick<ApplicationRow, 'status' | 'statusText' | 'internalNote'>>) => {
    if (!selected) return
    const nextStatus = patch?.status ?? status
    const nextText = patch?.statusText ?? statusText
    setSaving(true)
    try {
      await execute(`/api/applications/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStatus,
          statusText: nextText,
          internalNote: patch?.internalNote ?? internalNote,
        }),
      })
      addToast({ type: 'success', title: 'Bewerbung aktualisiert' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: e instanceof Error ? e.message : '' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bewerbungen"
        description="Eingereichte Bewerbungen prüfen, Antworten auswerten und den sichtbaren Bewerbungsstatus setzen."
        action={canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {syncProgress && (
              <span className="text-[11.5px] text-[#d4d4d4]">
                {syncProgress.done} umbenannt · {syncProgress.remaining} offen
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => void syncAllNicknames(false)} loading={syncing}>
              <RefreshCw size={13} />
              Alle Discord-Namen setzen
              {(nicknameQueue?.pending ?? 0) > 0 && !syncing && ` (${nicknameQueue?.pending})`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void syncAllNicknames(true)} disabled={syncing}>
              Erneut für alle
            </Button>
          </div>
        ) : undefined}
      />

      {error && (
        <div className="rounded-[12px] border border-[#3b1616] bg-[#1c1111] px-4 py-3 text-[12.5px] text-[#fca5a5]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Gesamt" value={stats.total} />
        <StatCard label="Offen" value={stats.open} />
        <StatCard label="Gespräch" value={stats.interviews} />
        <StatCard label="Angenommen" value={stats.accepted} />
        <StatCard label="Abgelehnt" value={stats.rejected} />
      </div>

      {(applications ?? []).length === 0 ? (
        <section className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 py-14 text-center">
          <ClipboardList size={28} className="mx-auto mb-3 text-[#808080]" />
          <p className="text-[14px] font-semibold text-white">Noch keine Bewerbungen vorhanden</p>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">Neue Abgaben erscheinen automatisch in dieser Liste.</p>
        </section>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[330px_1fr]">
          <aside className="overflow-hidden rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 lg:sticky lg:top-4">
            <div className="flex items-center justify-between border-b border-[#343434]/45 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a6a6a6]">Bewerbungseingang</p>
              <span className="text-[10.5px] text-[#686868]">
                {filtered.length}
                {filtered.length !== (applications?.length ?? 0) && ` / ${applications?.length ?? 0}`}
              </span>
            </div>

            <div className="space-y-2 border-b border-[#343434]/45 px-2.5 py-2.5">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#808080]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Aktenzeichen oder Name suchen"
                  className="h-[34px] w-full rounded-[8px] border border-[#343434]/70 bg-[#181818] pl-8 pr-3 text-[13px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    className={cn(
                      'rounded-[7px] border px-2 py-1 text-[11px] font-medium transition-colors',
                      statusFilter === option.value
                        ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                        : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[min(690px,calc(100vh-260px))] min-h-[240px] overflow-y-auto p-1.5">
              {filtered.map((application) => (
                <ApplicationListItem
                  key={application.id}
                  application={application}
                  active={selected?.id === application.id}
                  onSelect={() => setSelectedId(application.id)}
                />
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-8 text-center text-[12px] text-[#909090]">
                  Keine Bewerbung passt zu Suche und Filter.
                </p>
              )}
            </div>
          </aside>

          {selected && (
            <section className="space-y-4">
              <ApplicationDetailHeader
                application={selected}
                canManage={canManage}
                syncing={syncing}
                onSyncNickname={syncNickname}
              />

              <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileText size={15} className="text-[#d4d4d4]" />
                  <h3 className="text-[14px] font-semibold text-white">Antworten</h3>
                </div>
                <div className="space-y-3">
                  {selected.answers.map((answer, index) => (
                    <div key={answer.id} className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/55 p-3">
                      <div className="mb-2 flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#232323] text-[10px] font-semibold text-[#d4d4d4]">
                          {index + 1}
                        </span>
                        <p className="text-[13px] font-semibold text-white">{answer.questionTitle}</p>
                      </div>
                      <p className="whitespace-pre-wrap pl-7 text-[12.5px] leading-5 text-[#e5e5e5]">{applicationAnswerText(answer)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquareText size={15} className="text-[#d4d4d4]" />
                  <h3 className="text-[14px] font-semibold text-white">HR-Status</h3>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
                  <Select
                    label="Status"
                    value={status}
                    onValueChange={(value) => {
                      const next = value as JobApplicationStatusValue
                      setStatus(next)
                      setStatusText(JOB_APPLICATION_STATUS_META[next].defaultText)
                    }}
                    options={statusOptions}
                    disabled={!canManage || saving}
                  />
                  <Textarea
                    label="Sichtbarer Bewerbungsstatus"
                    value={statusText}
                    onChange={(event) => setStatusText(event.target.value)}
                    rows={2}
                    disabled={!canManage || saving}
                  />
                </div>
                <Textarea
                  label="Interne HR-Notiz"
                  value={internalNote}
                  onChange={(event) => setInternalNote(event.target.value)}
                  rows={3}
                  className="mt-3"
                  disabled={!canManage || saving}
                />

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => updateApplication({
                      status: 'REJECTED',
                      statusText: JOB_APPLICATION_STATUS_META.REJECTED.defaultText,
                    })}
                    loading={saving}
                    disabled={!canManage}
                  >
                    <XCircle size={13} />
                    Ablehnen
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => updateApplication({
                      status: 'ACCEPTED',
                      statusText: JOB_APPLICATION_STATUS_META.ACCEPTED.defaultText,
                    })}
                    loading={saving}
                    disabled={!canManage}
                  >
                    <CheckCircle2 size={13} />
                    Annehmen
                  </Button>
                  <Button size="sm" onClick={() => updateApplication()} loading={saving} disabled={!canManage}>
                    <Save size={13} />
                    Speichern
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-white/[0.04] bg-[#1b1b1b]/70 px-4 py-3">
      <p className="text-[20px] font-semibold leading-tight text-white tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-[#a6a6a6]">{label}</p>
    </div>
  )
}

function ApplicationListItem({
  application,
  active,
  onSelect,
}: {
  application: ApplicationRow
  active: boolean
  onSelect: () => void
}) {
  const meta = JOB_APPLICATION_STATUS_META[application.status]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-[9px] border px-3 py-2.5 text-left transition-colors',
        active ? 'border-[#d4d4d4]/35 bg-[#d4d4d4]/12' : 'border-transparent hover:bg-[#232323]/60',
      )}
    >
      <div className="flex items-start gap-2.5">
        <ApplicantAvatar application={application} size="sm" />
        <div className="min-w-0 flex-1">
          {application.caseNumber && (
            <p className="truncate font-mono text-[11px] font-semibold tracking-wide text-[#d4d4d4]">
              {application.caseNumber}
            </p>
          )}
          <p className="truncate text-[13px] font-semibold text-white">
            {stripApplicationCaseNumber(application.applicantDisplayName)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#909090]">Eingereicht {formatDateTime(application.submittedAt)}</p>
        </div>
        <Badge variant={meta.variant}>{meta.shortLabel}</Badge>
      </div>
    </button>
  )
}

function ApplicationDetailHeader({
  application,
  canManage,
  syncing,
  onSyncNickname,
}: {
  application: ApplicationRow
  canManage: boolean
  syncing: boolean
  onSyncNickname: () => void
}) {
  const meta = JOB_APPLICATION_STATUS_META[application.status]

  return (
    <div className="rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/70 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ApplicantAvatar application={application} size="lg" />
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={meta.variant}>{meta.label}</Badge>
              {application.caseNumber && (
                <span className="rounded-[6px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-[#d4d4d4]">
                  {application.caseNumber}
                </span>
              )}
              <span className="text-[11.5px] text-[#909090]">Aktualisiert {formatDateTime(application.updatedAt)}</span>
            </div>
            <h2 className="truncate text-[19px] font-semibold text-white">
              {stripApplicationCaseNumber(application.applicantDisplayName)}
            </h2>
            <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
              {application.discordGlobalName || application.discordUsername || application.discordId}
            </p>
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#e5e5e5]">{application.statusText}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2">
          <div className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/55 px-3 py-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#808080]">Review</p>
            <p className="mt-1 text-[12px] text-[#c3c3c3]">
              {application.reviewedBy ? application.reviewedBy.displayName : 'Noch offen'}
            </p>
            {application.reviewedAt && <p className="mt-0.5 text-[11px] text-[#909090]">{formatDateTime(application.reviewedAt)}</p>}
          </div>
          {canManage && (
            <Button variant="outline" size="sm" onClick={onSyncNickname} loading={syncing}>
              <RefreshCw size={13} />
              Discord-Name setzen
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ApplicantAvatar({ application, size }: { application: ApplicationRow; size: 'sm' | 'lg' }) {
  const avatarUrl = discordAvatarUrl(application)
  const className = size === 'lg' ? 'h-14 w-14 text-[17px]' : 'h-9 w-9 text-[12px]'
  // Ohne Aktenzeichen-Präfix, sonst trägt jeder Bewerber ein „B“ als Initiale.
  const name = stripApplicationCaseNumber(application.applicantDisplayName)
  if (avatarUrl) {
    return (
      <span
        className={cn('shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/25', className)}
        style={{ backgroundImage: `url(${avatarUrl})` }}
        aria-label={name}
      />
    )
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-[#d4d4d4]/90 font-bold text-[#181818]', className)}>
      {name ? name.charAt(0).toUpperCase() : <UserRound size={14} />}
    </div>
  )
}
