'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AgentLite } from '@/components/investigations/types'

function agentLabel(agent: AgentLite) {
  return `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`
}

function matches(agent: AgentLite, needle: string) {
  if (!needle) return true
  const haystack = `${agent.firstName} ${agent.lastName} ${agent.badgeNumber} ${agent.rank?.name ?? ''}`
  return haystack.toLowerCase().includes(needle)
}

interface AgentPickerProps {
  label?: string
  description?: string
  agents: AgentLite[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

/**
 * Mehrfachauswahl von Agents mit Suche. Eine reine Checkbox-Liste skaliert
 * hier nicht – die Agent-Tabelle hat schnell dreistellig viele Einträge.
 */
export function AgentPicker({
  label = 'Zugewiesene Ermittler',
  description,
  agents,
  value,
  onChange,
  disabled,
}: AgentPickerProps) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value), [value])

  const selectedAgents = useMemo(
    () => agents.filter((agent) => selected.has(agent.id)),
    [agents, selected],
  )

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () => agents.filter((agent) => !selected.has(agent.id) && matches(agent, needle)).slice(0, 40),
    [agents, selected, needle],
  )

  const toggle = (agentId: string) => {
    if (disabled) return
    onChange(selected.has(agentId) ? value.filter((id) => id !== agentId) : [...value, agentId])
  }

  // Ohne Discord-Verknüpfung lässt sich der Agent keinem Dashboard-Konto
  // zuordnen – die Zuweisung öffnet dann keine Verschlusssache.
  const unlinked = selectedAgents.filter((agent) => !agent.discordId)

  return (
    <div>
      <p className="mb-2 block text-[12.5px] font-medium text-[#aeaeae]">{label}</p>
      {description && <p className="mb-2 text-[11.5px] text-[#6f6f6f]">{description}</p>}

      <div className="rounded-[10px] border border-[#343434]/60 bg-[#181818]/35 p-3">
        {selectedAgents.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {selectedAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggle(agent.id)}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-2 py-[3px] text-[11.5px] text-[#c4b5fd] transition-colors hover:border-[#a78bfa]/60 disabled:opacity-50"
              >
                {agentLabel(agent)}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#808080]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Agent suchen (Name, Dienstnummer, Rang)"
            className="pl-9"
            disabled={disabled}
          />
        </div>

        <div className="mt-2 max-h-[220px] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-1 py-3 text-[12px] text-[#6a6a6a]">
              {needle ? 'Kein Agent gefunden.' : 'Alle passenden Agents sind bereits zugewiesen.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {visible.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => toggle(agent.id)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px] transition-colors',
                      'text-[#d4d4d4] hover:bg-[#232323] hover:text-white disabled:opacity-50',
                    )}
                  >
                    <span className="truncate">
                      {agentLabel(agent)}
                      {agent.rank && (
                        <span className="ml-2 text-[11px] text-[#6a6a6a]">{agent.rank.name}</span>
                      )}
                    </span>
                    <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {unlinked.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-[#d4a017]">
          <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
          <span>
            {unlinked.map(agentLabel).join(', ')}{' '}
            {unlinked.length === 1 ? 'hat' : 'haben'} keine Discord-Verknüpfung und erhält dadurch
            keinen Zugriff auf Verschlusssachen.
          </span>
        </p>
      )}
    </div>
  )
}
