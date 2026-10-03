'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Crown, Trophy } from 'lucide-react'

import { AgentAvatar } from '@/components/agents/agent-avatar'
import { TabBar } from '@/components/ui/tab-bar'
import { useFetch } from '@/hooks/use-fetch'
import { displayBadgeNumber } from '@/lib/badge-number'
// Nur der Typ: @/lib/duty-times zieht Prisma und gehört nicht ins Client-Bundle.
import type { LeaderboardPeriod } from '@/lib/duty-times'
import { cn } from '@/lib/utils'

export type LeaderboardRow = {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  rank: { name: string }
  durationMs: number
  /** Kleiner Zusatz unter der Zeit, z. B. Anzahl Sessions. */
  detail?: string
  /** Rechts in der Listenzeile, z. B. Live-Status. */
  aside?: ReactNode
}

type LeaderboardResponse = {
  start: string
  end: string
  participantCount: number
  rows: Omit<LeaderboardRow, 'detail' | 'aside'>[]
}

const TABS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'week', label: 'Diese Woche' },
  { id: 'month', label: 'Dieser Monat' },
  { id: 'last-month', label: 'Vormonat' },
]

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

const monthLabel = (iso: string) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(iso))

/**
 * Dienstzeit-Rangliste. Die Woche kommt fertig aus dem Live-Snapshot der Seite,
 * Monat und Vormonat werden erst beim Umschalten geladen.
 */
export function DutyLeaderboard({ weekRows, note }: { weekRows: LeaderboardRow[]; note?: string }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week')
  const { data, loading, error } = useFetch<LeaderboardResponse>(period === 'week' ? null : `/api/duty-times/leaderboard?period=${period}`)

  const rows: LeaderboardRow[] = period === 'week' ? weekRows : data?.rows ?? []
  const caption = period === 'week' ? note : data ? `${monthLabel(data.start)} · ${data.participantCount} mit Dienstzeit` : undefined
  const max = Math.max(...rows.map((row) => row.durationMs), 1)
  const podium = rows.slice(0, 3)

  return (
    <section className="glass-panel-elevated rounded-[14px] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[#d4d4d4]" />
          <h3 className="text-[13.5px] font-semibold text-[#fafafa]">Top-Dienstzeit</h3>
        </div>
        {caption && <span className="text-[11.5px] text-[#8e8e93]">{caption}</span>}
      </div>

      <TabBar tabs={TABS} active={period} onSelect={(id) => setPeriod(id as LeaderboardPeriod)} label="Zeitraum der Rangliste" />

      {period !== 'week' && loading && !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((key) => <div key={key} className="h-[112px] animate-pulse rounded-[12px] bg-[#1c1c1e]/75" />)}
        </div>
      ) : period !== 'week' && error ? (
        <p role="alert" className="py-6 text-center text-[12.5px] text-red-300">{error}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-[#8e8e93]">In diesem Zeitraum gibt es noch keine Dienstzeit.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {podium.map((agent, index) => {
              const place = index + 1
              const colors = place === 1
                ? { ring: 'ring-[#d4d4d4]/40', text: 'text-[#d4d4d4]', label: 'bg-[#d4d4d4] text-[#1c1c1e]' }
                : place === 2
                  ? { ring: 'ring-[#c7c7c7]/30', text: 'text-[#c7c7c7]', label: 'bg-[#c7c7c7] text-[#1c1c1e]' }
                  : { ring: 'ring-[#b08968]/30', text: 'text-[#b08968]', label: 'bg-[#b08968] text-[#1c1c1e]' }
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className={cn(
                    'rounded-[12px] border border-[#38383a]/55 bg-[#1c1c1e]/75 p-4 ring-1 transition-transform hover:-translate-y-0.5',
                    colors.ring,
                    // Sichtbare Reihenfolge 2 · 1 · 3, Lesereihenfolge bleibt 1 · 2 · 3.
                    place === 1 && 'md:order-2 md:scale-[1.03]',
                    place === 2 && 'md:order-1',
                    place === 3 && 'md:order-3',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <AgentAvatar agent={agent} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-white">{agent.firstName} {agent.lastName}</p>
                        <p className="font-mono text-[11px] text-[#8e8e93]">#{displayBadgeNumber(agent.badgeNumber)} · {agent.rank.name}</p>
                      </div>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', colors.label)}>
                      {place === 1 && <Crown size={14} />} {place}
                    </span>
                  </div>
                  <p className={cn('mt-3 text-[20px] font-semibold tabular-nums', colors.text)}>{formatDuration(agent.durationMs)}</p>
                  {agent.detail && <p className="text-[11px] text-[#8e8e93]">{agent.detail}</p>}
                </Link>
              )
            })}
          </div>

          {rows.length > 3 && (
            <ol start={4} className="space-y-2">
              {rows.slice(3).map((agent, index) => (
                <li key={agent.id}>
                  <Link
                    href={`/agents/${agent.id}`}
                    className={cn(
                      'grid items-center gap-3 rounded-[10px] border border-[#38383a]/40 bg-[#1c1c1e]/55 px-3 py-2.5 transition-colors hover:border-[#d4d4d4]/25',
                      agent.aside ? 'grid-cols-[minmax(0,1fr)_88px]' : 'grid-cols-1',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-[12.5px] font-medium text-white">
                          <span className="mr-2 tabular-nums text-[#8e8e93]">{index + 4}.</span>
                          {agent.firstName} {agent.lastName} <span className="font-mono text-[#d4d4d4]">#{displayBadgeNumber(agent.badgeNumber)}</span>
                        </p>
                        <span className="shrink-0 text-[12px] font-semibold tabular-nums text-[#d4d4d4]">{formatDuration(agent.durationMs)}</span>
                      </div>
                      <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-[#000000]/80">
                        <div className="h-full rounded-full bg-[#0a84ff]" style={{ width: `${Math.max(4, (agent.durationMs / max) * 100)}%` }} />
                      </div>
                    </div>
                    {agent.aside}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
