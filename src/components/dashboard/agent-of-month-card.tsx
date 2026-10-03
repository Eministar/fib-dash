'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Award, Crown } from 'lucide-react'

import { AgentAvatar } from '@/components/agents/agent-avatar'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { monthKeyLabel } from '@/lib/agent-of-month'
import { displayBadgeNumber } from '@/lib/badge-number'

type MonthAgent = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank: { name: string; color: string }
}

type AgentOfMonthState = {
  month: string
  previousMonth: string
  winners: (MonthAgent & { votes: number; avatarUrl: string | null })[]
  canVote: boolean
  myVoteAgentId: string | null
  voteCount: number
  candidates: MonthAgent[]
}

/**
 * Agent des Monats: zeigt den Sieger des Vormonats und nimmt die eigene
 * Stimme für den laufenden Monat entgegen. Zwischenstände bleiben bis
 * Monatsende verborgen, damit niemand der Mehrheit hinterherwählt.
 */
export function AgentOfMonthCard() {
  const { data, refetch } = useFetch<AgentOfMonthState>('/api/agent-of-month')
  const { execute } = useApi()
  const { addToast } = useToast()
  const [saving, setSaving] = useState(false)

  if (!data) return null
  // Nichts zu zeigen und nichts zu tun – z. B. Besucher ohne Agent vor dem ersten Sieger.
  if (data.winners.length === 0 && !data.canVote) return null

  const vote = async (agentId: string | null) => {
    setSaving(true)
    try {
      await execute('/api/agent-of-month', agentId
        ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) }
        : { method: 'DELETE' })
      addToast({ type: 'success', title: agentId ? 'Stimme gespeichert' : 'Stimme zurückgezogen' })
      refetch()
    } catch (cause) {
      addToast({ type: 'error', title: 'Abstimmung fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="agent-of-month-heading" className="rounded-[14px] border border-[#38383a]/55 bg-[#1c1c1e]/70 p-4">
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <div className="min-w-0">
          <h2 id="agent-of-month-heading" className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
            <Crown size={14} className="text-[#d4d4d4]" />
            Agent des Monats · {monthKeyLabel(data.previousMonth)}
          </h2>
          {data.winners.length > 0 ? (
            <ul className="space-y-2">
              {data.winners.map((agent) => (
                <li key={agent.id}>
                  <Link href={`/agents/${agent.id}`} className="group flex items-center gap-3 rounded-[10px] px-1 py-1 transition-colors hover:bg-[#2c2c2e]">
                    <AgentAvatar agent={agent} ringColor={agent.rank.color} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-white">{agent.firstName} {agent.lastName}</span>
                      <span className="block text-[11.5px] text-[#8e8e93]">
                        <span className="font-mono">#{displayBadgeNumber(agent.badgeNumber)}</span> · {agent.rank.name} · {agent.votes} {agent.votes === 1 ? 'Stimme' : 'Stimmen'}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-[#8e8e93]">Im {monthKeyLabel(data.previousMonth)} wurde nicht abgestimmt.</p>
          )}
        </div>

        {data.canVote && (
          <div className="min-w-0 border-t border-[#38383a]/55 pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-white">
              <Award size={14} className="text-[#8e8e93]" />
              Deine Stimme für {monthKeyLabel(data.month)}
            </h3>
            <p className="mb-3 text-[11.5px] text-[#8e8e93]">
              Bis Monatsende änderbar. Bisher {data.voteCount} {data.voteCount === 1 ? 'Stimme' : 'Stimmen'} – das Ergebnis gibt es erst im neuen Monat.
            </p>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  size="sm"
                  value={data.myVoteAgentId ?? ''}
                  placeholder="Agent wählen …"
                  disabled={saving}
                  onValueChange={(value) => { if (value && value !== data.myVoteAgentId) void vote(value) }}
                  options={data.candidates.map((agent) => ({
                    value: agent.id,
                    label: `${agent.firstName} ${agent.lastName} · #${displayBadgeNumber(agent.badgeNumber)}`,
                  }))}
                />
              </div>
              {data.myVoteAgentId && (
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => void vote(null)}>
                  Zurückziehen
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
