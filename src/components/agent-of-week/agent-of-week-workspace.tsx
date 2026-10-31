'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Check, Crown, History, RefreshCw, Star, Trash2, Trophy, Users } from 'lucide-react'

import { AgentAvatar } from '@/components/agents/agent-avatar'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ListSkeleton } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { TabBar } from '@/components/ui/tab-bar'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useUrlState } from '@/hooks/use-url-state'
import { displayBadgeNumber } from '@/lib/agents/badge-number'
import {
  MAX_SCORE,
  MIN_SCORE,
  RATING_CATEGORIES,
  formatScore,
  weekKeyLabel,
  weekKeyShort,
  type RatingCategory,
  type RatingScores,
} from '@/lib/agents/agent-of-week'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'

type WeekAgent = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank: { name: string; color: string }
  avatarUrl?: string | null
}

type Scores = RatingScores & { overall: number; ratingCount: number }

type RankingRow = Scores & { agentId: string; place: number; qualified: boolean; agent: WeekAgent }

type ResultRow = Scores & {
  week: string
  agentId: string | null
  firstName: string
  lastName: string
  badgeNumber: string
  place: number
  agent?: WeekAgent | null
}

type AgentOfWeekState = {
  week: string
  raterCount: number
  ranking: RankingRow[]
  winners: { week: string; agents: ResultRow[] } | null
  history: { week: string; agents: ResultRow[] }[]
  canRate: boolean
  needsAgentLink: boolean
  canManage: boolean
  candidates: WeekAgent[]
  myRatings: (RatingScores & { agentId: string })[]
}

type Tab = 'ranking' | 'rate' | 'history'

const GOLD = '#f0b232'

export function AgentOfWeekWorkspace() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'agent-of-week:view')
  const canSettings = hasPermission(user, 'settings:manage')
  const { data, loading, error, refetch } = useFetch<AgentOfWeekState>(canView ? '/api/agent-of-week' : null)
  const [tab, setTab] = useUrlState<Tab>('tab', 'ranking', ['ranking', 'rate', 'history'])
  const { execute, loading: syncing } = useApi()
  const { addToast } = useToast()
  if (!canView) return <UnauthorizedContent />

  const showRateTab = Boolean(data?.canRate || data?.needsAgentLink)
  const rated = new Set(data?.myRatings.map((row) => row.agentId))
  const open = data ? data.candidates.filter((agent) => !rated.has(agent.id)).length : 0
  const tabs = [
    { id: 'ranking', label: 'Ranking' },
    ...(showRateTab ? [{ id: 'rate', label: open ? `Bewerten (${open} offen)` : 'Bewerten' }] : []),
    { id: 'history', label: 'Verlauf' },
  ]
  const activeTab = tab === 'rate' && !showRateTab ? 'ranking' : tab

  const syncBoard = async () => {
    try {
      await execute('/api/agent-of-week/board/sync', { method: 'POST' })
      addToast({ type: 'success', title: 'Discord-Board aktualisiert' })
    } catch (cause) {
      addToast({ type: 'error', title: 'Synchronisierung fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return <div>
    <PageHeader
      title="Agent der Woche"
      eyebrow="FIB · Auszeichnung"
      description="Jede Woche bewerten die Berechtigten alle Agents in vier Kategorien. Der beste Durchschnitt holt den Titel."
      action={canSettings && <Button variant="outline" loading={syncing} onClick={() => void syncBoard()}><RefreshCw size={15} />Board aktualisieren</Button>}
    />
    <TabBar label="Agent-der-Woche-Ansicht" active={activeTab} tabs={tabs} onSelect={(value) => setTab(value as Tab)} />
    <div role="tabpanel" aria-label={tabs.find((item) => item.id === activeTab)?.label}>
      {error && <p role="alert" className="mb-4 text-sm text-[#fca5a5]">{error} <Button variant="ghost" onClick={() => void refetch()}>Erneut laden</Button></p>}
      {loading && !data ? <div className="glass-panel rounded-xl p-5"><ListSkeleton /></div> : data && <>
        {activeTab === 'ranking' && <RankingView data={data} />}
        {activeTab === 'rate' && <RateView data={data} onSaved={() => void refetch()} />}
        {activeTab === 'history' && <HistoryView history={data.history} />}
      </>}
    </div>
  </div>
}

function agentName(agent: { firstName: string; lastName: string }) {
  return `${agent.firstName} ${agent.lastName}`
}

function ScoreBar({ value, color = GOLD }: { value: number; color?: string }) {
  return <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[#38383a]" aria-hidden>
    <span className="block h-full rounded-full" style={{ width: `${(value / MAX_SCORE) * 100}%`, backgroundColor: color }} />
  </span>
}

function CategoryScores({ scores, color, compact }: { scores: RatingScores; color?: string; compact?: boolean }) {
  return <dl className={cn('grid gap-x-5 gap-y-2', compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2')}>
    {RATING_CATEGORIES.map(({ key, label, short, emoji }) => (
      <div key={key} className="min-w-0">
        <dt className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-[#8e8e93]">
          <span className="truncate"><span aria-hidden>{emoji}</span> {compact ? short : label}</span>
          <span className="font-semibold tabular-nums text-white">{formatScore(scores[key])}</span>
        </dt>
        <dd><ScoreBar value={scores[key]} color={color} /></dd>
      </div>
    ))}
  </dl>
}

function WinnerHero({ winners }: { winners: AgentOfWeekState['winners'] }) {
  return <section aria-labelledby="aotw-winner" className="relative mb-4 overflow-hidden rounded-xl border border-[#f0b232]/25 bg-[linear-gradient(135deg,rgba(240,178,50,.12),rgba(28,28,30,.9)_55%)] p-5">
    <h2 id="aotw-winner" className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-white">
      <Trophy size={15} style={{ color: GOLD }} aria-hidden />
      Agent der Woche{winners && <span className="font-normal text-[#c7c7cc]"> · {weekKeyLabel(winners.week)}</span>}
    </h2>
    {!winners ? (
      <p className="text-sm text-[#98989d]">Noch kein Titel vergeben. Die erste Wertung endet am Sonntag um Mitternacht.</p>
    ) : (
      <ul className="space-y-5">
        {winners.agents.map((row) => {
          const content = <>
            <AgentAvatar agent={row.agent ?? row} size="lg" ringColor={GOLD} />
            <span className="min-w-0">
              <span className="block truncate text-[18px] font-semibold text-white">{agentName(row)}</span>
              <span className="block text-[12px] text-[#98989d]">
                <span className="font-mono">#{displayBadgeNumber(row.badgeNumber)}</span>{row.agent && ` · ${row.agent.rank.name}`} · {row.ratingCount} Bewertungen
              </span>
            </span>
          </>
          return <li key={`${row.week}:${row.agentId ?? agentName(row)}`} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] md:items-center">
            {row.agentId
              ? <Link href={`/agents/${row.agentId}`} className="flex min-w-0 items-center gap-3 rounded-[10px] transition-opacity hover:opacity-85">{content}</Link>
              : <div className="flex min-w-0 items-center gap-3">{content}</div>}
            <div className="text-left md:px-4 md:text-center">
              <span className="block text-[34px] font-bold leading-none tabular-nums" style={{ color: GOLD }}>{formatScore(row.overall)}</span>
              <span className="text-[11px] uppercase tracking-wide text-[#8e8e93]">von 10</span>
            </div>
            <CategoryScores scores={row} />
          </li>
        })}
      </ul>
    )}
  </section>
}

function RankingView({ data }: { data: AgentOfWeekState }) {
  const [inspect, setInspect] = useState<RankingRow | null>(null)
  return <>
    <WinnerHero winners={data.winners} />
    <section aria-labelledby="aotw-live" className="glass-panel rounded-xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="aotw-live" className="flex items-center gap-2 text-[14px] font-semibold text-white">
          <Star size={15} className="text-[#8e8e93]" aria-hidden />Live-Ranking · {weekKeyLabel(data.week)}
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-[#8e8e93]"><Users size={13} aria-hidden />{data.raterCount} Bewerter</span>
      </div>
      {!data.ranking.length ? (
        <div className="py-12 text-center">
          <Trophy className="mx-auto mb-3 text-[#8e8e93]" aria-hidden />
          <p className="text-sm text-[#98989d]">Für {weekKeyShort(data.week)} liegen noch keine Bewertungen vor.</p>
        </div>
      ) : (
        <ol className="divide-y divide-[#38383a]/60">
          {data.ranking.map((row) => <li key={row.agentId} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 py-4 lg:grid-cols-[2.25rem_minmax(0,15rem)_4.5rem_minmax(0,1fr)_auto]">
            <span className={cn('text-center text-[15px] font-bold tabular-nums', row.place === 1 && row.qualified ? 'text-[#f0b232]' : row.place <= 3 && row.qualified ? 'text-[#d1d1d6]' : 'text-[#8e8e93]')}>
              {row.place}.
            </span>
            <Link href={`/agents/${row.agentId}`} className="flex min-w-0 items-center gap-3 hover:opacity-85">
              <AgentAvatar agent={row.agent} ringColor={row.agent.rank.color} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-white">{agentName(row.agent)}</span>
                <span className="block truncate text-[11.5px] text-[#8e8e93]">
                  #{displayBadgeNumber(row.agent.badgeNumber)} · {row.ratingCount} {row.ratingCount === 1 ? 'Bewertung' : 'Bewertungen'}
                  {!row.qualified && <span className="text-[#fbbf24]"> · zu wenige für den Titel</span>}
                </span>
              </span>
            </Link>
            <span className="text-right text-[22px] font-bold tabular-nums text-white lg:text-center">{formatScore(row.overall)}</span>
            <div className="col-span-3 lg:col-span-1"><CategoryScores scores={row} color={row.place === 1 && row.qualified ? GOLD : '#a1a1aa'} compact /></div>
            {data.canManage && <div className="col-span-3 flex justify-end lg:col-span-1">
              <Button size="sm" variant="ghost" onClick={() => setInspect(row)}>Bewertungen</Button>
            </div>}
          </li>)}
        </ol>
      )}
      <p className="mt-4 border-t border-[#38383a]/60 pt-3 text-[11.5px] leading-relaxed text-[#8e8e93]">
        Gesamt ist der Durchschnitt der vier Kategorien. Für den Titel braucht ein Agent mindestens halb so viele Bewertungen wie der meistbewertete Agent der Woche. Einzelbewertungen bleiben anonym.
      </p>
    </section>
    {inspect && <ManageRatingsModal row={inspect} onClose={() => setInspect(null)} />}
  </>
}

type SingleRating = RatingScores & { id: string; updatedAt: string; rater: { id: string; displayName: string } }

function ManageRatingsModal({ row, onClose }: { row: RankingRow; onClose: () => void }) {
  const { data, loading, error, refetch } = useFetch<SingleRating[]>(`/api/agent-of-week/ratings?agentId=${encodeURIComponent(row.agentId)}`)
  const { execute } = useApi()
  const { addToast } = useToast()
  const confirm = useConfirm()

  const remove = async (rating: SingleRating) => {
    const ok = await confirm({ title: 'Bewertung löschen?', description: `Die Bewertung von ${rating.rater.displayName} für ${agentName(row.agent)} wird entfernt. Das Ranking rechnet sofort neu.`, confirmLabel: 'Löschen', tone: 'danger' })
    if (!ok) return
    try {
      await execute(`/api/agent-of-week/ratings/${rating.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Bewertung gelöscht' })
      void refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return <Modal open onClose={onClose} title={`Bewertungen · ${agentName(row.agent)}`} description="Nur für die Verwaltung sichtbar. Löschen ist nur in der laufenden Woche möglich." size="lg">
    {error && <p role="alert" className="text-sm text-[#fca5a5]">{error}</p>}
    {loading && !data ? <ListSkeleton /> : !data?.length ? <p className="text-sm text-[#98989d]">Keine Bewertungen.</p> : (
      <ul className="divide-y divide-[#38383a]/60">
        {data.map((rating) => <li key={rating.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-white">{rating.rater.displayName}</span>
          <span className="flex gap-3 text-[12px] tabular-nums text-[#c7c7cc]">
            {RATING_CATEGORIES.map(({ key, emoji, short }) => <span key={key} title={short}><span aria-hidden>{emoji}</span> {rating[key]}</span>)}
          </span>
          <Button size="sm" variant="ghost" aria-label={`Bewertung von ${rating.rater.displayName} löschen`} onClick={() => void remove(rating)}><Trash2 size={14} aria-hidden /></Button>
        </li>)}
      </ul>
    )}
  </Modal>
}

function ScorePicker({ category, label, emoji, value, onChange, disabled }: {
  category: RatingCategory
  label: string
  emoji: string
  value: number | undefined
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const values = Array.from({ length: MAX_SCORE - MIN_SCORE + 1 }, (_, index) => MIN_SCORE + index)
  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="mb-1.5 flex w-full items-center justify-between text-[12px] text-[#98989d]">
      <span><span aria-hidden>{emoji}</span> {label}</span>
      <span className="font-semibold tabular-nums text-white">{value ?? '–'}<span className="font-normal text-[#8e8e93]"> / {MAX_SCORE}</span></span>
    </legend>
    <div role="radiogroup" aria-label={label} className="grid grid-cols-10 gap-1">
      {values.map((score) => {
        const selected = value === score
        return <button
          key={score}
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={`${label}: ${score}`}
          name={category}
          onClick={() => onChange(score)}
          className={cn(
            'h-8 rounded-[7px] text-[12.5px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b232]/70 disabled:opacity-50',
            selected ? 'bg-[#f0b232] text-[#1c1c1e]' : value !== undefined && score < value ? 'bg-[#f0b232]/20 text-[#f5d38a]' : 'bg-[#2c2c2e] text-[#98989d] hover:bg-[#3a3a3c] hover:text-white',
          )}
        >{score}</button>
      })}
    </div>
  </fieldset>
}

function RateView({ data, onSaved }: { data: AgentOfWeekState; onSaved: () => void }) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const mine = useMemo(() => new Map(data.myRatings.map(({ agentId, ...scores }) => [agentId, scores])), [data.myRatings])

  if (data.needsAgentLink) {
    return <div className="glass-panel rounded-xl p-6 text-sm text-[#98989d]">
      Zum Bewerten muss dein Benutzerkonto mit deinem Agent verknüpft sein. Wende dich dafür an die Verwaltung.
    </div>
  }

  const done = data.candidates.filter((agent) => mine.has(agent.id)).length
  const total = data.candidates.length
  const visible = onlyOpen ? data.candidates.filter((agent) => !mine.has(agent.id)) : data.candidates

  return <section aria-labelledby="aotw-rate" className="glass-panel rounded-xl p-4 sm:p-5">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h2 id="aotw-rate" className="text-[14px] font-semibold text-white">Deine Bewertungen · {weekKeyLabel(data.week)}</h2>
        <p className="mt-1 text-[12px] text-[#8e8e93]">Bewerte jeden Agent einmal pro Woche. Bis Sonntag 23:59 kannst du deine Noten ändern.</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="block h-2 flex-1 overflow-hidden rounded-full bg-[#38383a]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Fortschritt">
            <span className="block h-full rounded-full bg-[#f0b232] transition-[width] duration-300" style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-[#c7c7cc]">{done} von {total} bewertet</span>
        </div>
      </div>
      <Checkbox checked={onlyOpen} onCheckedChange={setOnlyOpen} label="Nur offene zeigen" />
    </div>
    {!visible.length ? (
      <div className="py-12 text-center">
        <Check className="mx-auto mb-3 text-[#34d399]" aria-hidden />
        <p className="text-sm text-[#98989d]">{total ? 'Alle Agents sind für diese Woche bewertet. Danke!' : 'Diese Woche gibt es keine Agents zu bewerten.'}</p>
      </div>
    ) : (
      <ul className="grid gap-3 xl:grid-cols-2">
        {visible.map((agent) => <RatingCard key={agent.id} agent={agent} saved={mine.get(agent.id)} onSaved={onSaved} />)}
      </ul>
    )}
  </section>
}

function RatingCard({ agent, saved, onSaved }: { agent: WeekAgent; saved?: RatingScores; onSaved: () => void }) {
  // Entwurf bleibt lokal, damit die Live-Aktualisierung der Seite keine halbfertige Eingabe überschreibt.
  const [draft, setDraft] = useState<Partial<RatingScores>>(saved ?? {})
  const { execute, loading } = useApi()
  const { addToast } = useToast()
  const complete = RATING_CATEGORIES.every(({ key }) => draft[key] !== undefined)
  const changed = !saved || RATING_CATEGORIES.some(({ key }) => draft[key] !== saved[key])

  const save = async () => {
    try {
      await execute('/api/agent-of-week', { method: 'PUT', body: JSON.stringify({ agentId: agent.id, ...draft }) })
      addToast({ type: 'success', title: saved ? 'Bewertung geändert' : 'Bewertung gespeichert', message: agentName(agent) })
      onSaved()
    } catch (cause) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return <li className={cn('rounded-[12px] border bg-[#1c1c1e]/70 p-4 transition-colors', saved ? 'border-[#34d399]/25' : 'border-[#38383a]/70')}>
    <div className="mb-4 flex items-center gap-3">
      <AgentAvatar agent={agent} ringColor={agent.rank.color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-white">{agentName(agent)}</span>
        <span className="block truncate text-[11.5px] text-[#8e8e93]">#{displayBadgeNumber(agent.badgeNumber)} · {agent.rank.name}</span>
      </span>
      {saved && <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-[#34d399]"><Check size={13} aria-hidden />Bewertet</span>}
    </div>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (complete) void save() }}>
      {RATING_CATEGORIES.map(({ key, label, emoji }) => <ScorePicker
        key={key}
        category={key}
        label={label}
        emoji={emoji}
        value={draft[key]}
        disabled={loading}
        onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
      />)}
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" loading={loading} disabled={!complete || !changed}>{saved ? 'Änderung speichern' : 'Bewertung speichern'}</Button>
      </div>
    </form>
  </li>
}

function HistoryView({ history }: { history: AgentOfWeekState['history'] }) {
  if (!history.length) {
    return <div className="glass-panel rounded-xl py-12 text-center">
      <History className="mx-auto mb-3 text-[#8e8e93]" aria-hidden />
      <p className="text-sm text-[#98989d]">Noch keine abgeschlossene Woche.</p>
    </div>
  }
  return <section aria-label="Bisherige Agents der Woche" className="glass-panel rounded-xl p-4 sm:p-5">
    <ol className="divide-y divide-[#38383a]/60">
      {history.flatMap(({ week, agents }) => agents.map((row) => <li key={`${week}:${row.agentId ?? agentName(row)}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 py-4 lg:grid-cols-[11rem_minmax(0,14rem)_4rem_minmax(0,1fr)]">
        <span className="col-span-2 flex items-center gap-2 text-[12px] text-[#8e8e93] lg:col-span-1">
          <Crown size={13} style={{ color: GOLD }} aria-hidden />{weekKeyLabel(week)}
        </span>
        <span className="min-w-0">
          {row.agentId
            ? <Link href={`/agents/${row.agentId}`} className="block truncate text-[14px] font-semibold text-white hover:opacity-85">{agentName(row)}</Link>
            : <span className="block truncate text-[14px] font-semibold text-white">{agentName(row)}</span>}
          <span className="block text-[11.5px] text-[#8e8e93]">#{displayBadgeNumber(row.badgeNumber)} · {row.ratingCount} Bewertungen</span>
        </span>
        <span className="text-right text-[20px] font-bold tabular-nums lg:text-center" style={{ color: GOLD }}>{formatScore(row.overall)}</span>
        <div className="col-span-2 lg:col-span-1"><CategoryScores scores={row} compact /></div>
      </li>))}
    </ol>
  </section>
}
