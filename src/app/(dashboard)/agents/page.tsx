'use client'

import { useState, useMemo, useCallback, type ReactNode, type CSSProperties } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import * as Popover from '@radix-ui/react-popover'
import {
  DndContext,
  type DragEndEvent,
  type CollisionDetection,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Search, Plus, ChevronDown, Users, Check, StickyNote, GripVertical, Flag, MessageCircle, CircleSlash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { UnitBadges } from '@/components/agents/unit-badges'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import {
  cn,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  getStatusLabel,
  getStatusDot,
  getFlagLabel,
  getFlagColor,
  getFlagRowClass,
  compareBadgeNumbers,
} from '@/lib/utils'
import { AGENT_FLAG_VALUES } from '@/lib/validations/agent'
import { hasPermission } from '@/lib/permissions'
import { agentUnitKeys } from '@/lib/agent-units'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { displayBadgeNumber, formatBadgeNumber } from '@/lib/badge-number'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import { RankNumberBadge } from '@/components/ranks/rank-number-badge'

interface Training {
  id: string
  key: string
  label: string
  sortOrder: number
  minRankId: string | null
  minRank: { id: string; name: string; sortOrder: number } | null
}

interface AgentTraining {
  id: string
  trainingId: string
  completed: boolean
  training: Training
}

interface Rank {
  id: string
  name: string
  sortOrder: number
  internalNumber: number | null
  color: string
  badgeMin: number | null
  badgeMax: number | null
}

interface Unit {
  id: string
  key: string
  name: string
  color: string
  sortOrder: number
  active: boolean
}

interface Agent {
  id: string
  badgeNumber: string
  firstName: string
  lastName: string
  rank: Rank
  rankId: string
  status: string
  unit: string | null
  units: string[] | null
  flag: string | null
  notes: string | null
  hireDate: string
  lastOnline: string | null
  discordId: string | null
  avatarUrl: string | null
  discordMember?: {
    checked: boolean
    inGuild: boolean
  }
  trainings: AgentTraining[]
}

const rankDropCollision: CollisionDetection = (args) => {
  const onlyDrop = (list: { id: string | number }[]) =>
    list.filter((c) => String(c.id).startsWith('drop-'))
  const fromPointer = onlyDrop(pointerWithin(args))
  if (fromPointer.length) return fromPointer
  return onlyDrop(rectIntersection(args))
}

function DropRankZone({ rankId, canHighlight, children }: { rankId: string; canHighlight: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${rankId}` })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-full min-w-0 rounded-[10px] transition-[box-shadow] duration-150',
        canHighlight && isOver && 'ring-1 ring-[#d4d4d4]/50 ring-inset'
      )}
    >
      {children}
    </div>
  )
}

const FLAG_OPTIONS: Array<{ id: string | null; label: string; color: string }> = [
  { id: null, label: 'Keine', color: 'transparent' },
  { id: 'RED', label: 'Rot', color: '#ef4444' },
  { id: 'ORANGE', label: 'Orange', color: '#f97316' },
  { id: 'YELLOW', label: 'Gelb', color: '#facc15' },
  { id: 'BLUE', label: 'Blau', color: '#38bdf8' },
]

function trainingAvailableForAgent(training: Training, agent: Agent) {
  return !training.minRank || agent.rank.sortOrder <= training.minRank.sortOrder
}

function DiscordMemberBadge({ agent, compact = false }: { agent: Pick<Agent, 'discordId' | 'discordMember'>; compact?: boolean }) {
  const hasDiscordId = !!agent.discordId
  const checked = !!agent.discordMember?.checked
  const inGuild = !!agent.discordMember?.inGuild
  const label = !hasDiscordId
    ? 'Nicht verknüpft'
    : checked
      ? inGuild ? 'Auf Discord' : 'Nicht auf Discord'
      : 'Discord ungeprüft'
  const className = !hasDiscordId || !checked
    ? 'border-[#404040]/50 bg-[#1d1d1d]/70 text-[#909090]'
    : inGuild
      ? 'border-[#166534]/50 bg-[#052e1a]/70 text-[#86efac]'
      : 'border-[#7f1d1d]/55 bg-[#2a1212]/70 text-[#fca5a5]'
  const Icon = hasDiscordId && checked && inGuild ? MessageCircle : CircleSlash

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[6px] border font-medium whitespace-nowrap',
        compact ? 'px-1.5 py-[2px] text-[10.5px]' : 'px-2 py-[3px] text-[11.5px]',
        className
      )}
      title={hasDiscordId ? `Discord-ID: ${agent.discordId}` : 'Keine Discord-ID am Agent hinterlegt'}
    >
      <Icon size={compact ? 10 : 11} strokeWidth={2} />
      {label}
    </span>
  )
}

function FlagButton({
  value,
  disabled,
  onChange,
  size = 'md',
}: {
  value: string | null
  disabled: boolean
  onChange: (v: string | null) => void
  size?: 'md' | 'lg'
}) {
  const dim = size === 'lg' ? 'h-[24px] w-[24px]' : 'h-[18px] w-[18px]'
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={value ? `Markierung: ${getFlagLabel(value)}` : 'Markierung setzen'}
      className={cn(
        'inline-flex items-center justify-center rounded-full border transition-all',
        dim,
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && 'hover:scale-110',
        value ? 'border-transparent shadow-sm' : 'border-[#808080]/60 hover:border-[#d4d4d4]/60'
      )}
      style={{ backgroundColor: value ? getFlagColor(value) : 'transparent' }}
      onClick={(e) => e.stopPropagation()}
    >
      {!value && <Flag size={size === 'lg' ? 13 : 10} className="text-[#808080]" strokeWidth={1.75} />}
    </button>
  )

  if (disabled) return trigger

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[200] glass-panel-elevated rounded-[10px] p-1.5 border border-[#404040]/90 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            {FLAG_OPTIONS.map((opt) => {
              const active = (opt.id ?? null) === (value ?? null)
              return (
                <Popover.Close key={String(opt.id)} asChild>
                  <button
                    type="button"
                    onClick={() => onChange(opt.id)}
                    title={opt.label}
                    className={cn(
                      'h-[28px] w-[28px] rounded-full border flex items-center justify-center transition-all',
                      active ? 'ring-2 ring-[#d4d4d4] ring-offset-1 ring-offset-[#1d1d1d] border-transparent' : 'border-[#404040]/70 hover:border-[#d4d4d4]/60'
                    )}
                    style={{ backgroundColor: opt.id ? opt.color : 'transparent' }}
                  >
                    {!opt.id && <Flag size={12} className="text-[#a6a6a6]" strokeWidth={1.75} />}
                  </button>
                </Popover.Close>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function DraggableAgentRow({
  agent,
  canDrag,
  canEdit,
  canEditTrainings,
  allTrainings,
  unitsByKey,
  rowIndex,
  onTrainToggle,
  onFlagChange,
}: {
  agent: Agent
  canDrag: boolean
  canEdit: boolean
  canEditTrainings: boolean
  allTrainings: Training[]
  unitsByKey: Map<string, Unit>
  rowIndex: number
  onTrainToggle: (id: string, trainingId: string, done: boolean) => void
  onFlagChange: (id: string, flag: string | null) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `drag-${agent.id}`,
    disabled: !canDrag,
  })
  const style: CSSProperties | undefined = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        'transition-colors duration-100',
        agent.flag ? getFlagRowClass(agent.flag) : 'hover:bg-[#212121]',
        isDragging && 'opacity-40 z-10',
        rowIndex > 0 && 'border-t border-[#343434]'
      )}
    >
      <td className="px-0 py-0 w-[3px]" aria-hidden>
        {agent.flag && (
          <span
            className="block h-full w-[3px]"
            style={{ backgroundColor: getFlagColor(agent.flag) }}
          />
        )}
      </td>
      <td className="px-1 py-2 w-7 text-center">
        {canDrag ? (
          <button
            type="button"
            className="inline-flex p-1 rounded-md text-[#808080] hover:text-[#d4d4d4] cursor-grab active:cursor-grabbing"
            aria-label="Zum Verschieben ziehen"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} strokeWidth={2} />
          </button>
        ) : (
          <span className="inline-block w-5" />
        )}
      </td>
      <td className="px-2 py-2.5 font-mono text-[12px] text-[#c3c3c3] align-middle">
        {displayBadgeNumber(agent.badgeNumber)}
      </td>
      <td className="px-3 py-2.5 align-middle min-w-0 overflow-hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentAvatar agent={agent} size="sm" ringColor={agent.rank.color} />
          <Link
            href={`/agents/${agent.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-[13px] font-medium text-[#eee] transition-colors hover:text-[#d4d4d4]"
            title={`${agent.firstName} ${agent.lastName}`}
          >
            {agent.firstName} {agent.lastName}
          </Link>
        </div>
      </td>
      {allTrainings.map((t) => {
        const ot = agent.trainings.find((x) => x.trainingId === t.id)
        const completed = ot?.completed || false
        const available = trainingAvailableForAgent(t, agent)
        return (
          <td key={t.id} className="px-1.5 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onTrainToggle(agent.id, t.id, !completed)}
              disabled={!canEditTrainings}
              title={!available ? `${t.label} ist erst ab ${t.minRank?.name ?? 'Mindestrang'} vorgesehen` : t.label}
              className={cn(
                'mx-auto h-[18px] w-[18px] rounded-[4px] flex items-center justify-center transition-all duration-150',
                completed ? 'bg-[#d4d4d4]' : available ? 'bg-[#343434]' : 'bg-[#1d1d1d] border border-dashed border-[#808080]/60',
                !available && !completed && 'opacity-70',
                canEditTrainings ? 'hover:bg-[#373737]' : 'cursor-not-allowed opacity-70'
              )}
            >
              {completed && <Check size={11} className="text-[#1d1d1d]" strokeWidth={3} />}
            </button>
          </td>
        )
      })}
      <td className="px-2 py-2.5 whitespace-nowrap">
        <UnitBadges agent={agent} unitsByKey={unitsByKey} maxVisible={2} />
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('h-[6px] w-[6px] rounded-full', getStatusDot(agent.status))} />
          <span className="text-[12px] text-[#a6a6a6]">{getStatusLabel(agent.status)}</span>
        </span>
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <DiscordMemberBadge agent={agent} compact />
      </td>
      <td className="px-2 py-2.5 text-[12px] text-[#a6a6a6]" title={agent.lastOnline ? formatDateTime(agent.lastOnline) : 'Nie online gewesen'}>
        {agent.lastOnline ? formatRelativeTime(agent.lastOnline) : 'Nie'}
      </td>
      <td className="px-2 py-2.5 text-[12px] text-[#a6a6a6]">{formatDate(agent.hireDate)}</td>
      <td className="px-1.5 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="inline-flex items-center gap-1.5">
          <FlagButton
            value={agent.flag}
            disabled={!canEdit}
            onChange={(v) => onFlagChange(agent.id, v)}
          />
          {agent.notes && <StickyNote size={12} className="text-[#808080]" strokeWidth={1.75} />}
        </div>
      </td>
    </tr>
  )
}

function MobileAgentCard({
  agent,
  allTrainings,
  unitsByKey,
  canEdit,
  canEditTrainings,
  onTrainToggle,
  onFlagChange,
}: {
  agent: Agent
  allTrainings: Training[]
  unitsByKey: Map<string, Unit>
  canEdit: boolean
  canEditTrainings: boolean
  onTrainToggle: (id: string, trainingId: string, done: boolean) => void
  onFlagChange: (id: string, flag: string | null) => void
}) {
  return (
    <div
      className={cn(
        'relative w-full rounded-[10px] border border-[#343434]/40 px-3.5 py-3 transition-colors',
        agent.flag ? getFlagRowClass(agent.flag) : 'bg-[#181818]/60 hover:bg-[#212121]'
      )}
    >
      {agent.flag && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px]"
          style={{ backgroundColor: getFlagColor(agent.flag) }}
        />
      )}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AgentAvatar agent={agent} ringColor={agent.rank.color} />
          <div className="min-w-0">
            <span className="mb-1 block font-mono text-[11px] text-[#c3c3c3]">
              {displayBadgeNumber(agent.badgeNumber)}
            </span>
            <Link
              href={`/agents/${agent.id}`}
              className="block truncate text-[14px] font-semibold text-[#eee] transition-colors hover:text-[#d4d4d4]"
            >
              {agent.firstName} {agent.lastName}
            </Link>
          </div>
        </div>
        <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
          <FlagButton
            value={agent.flag}
            disabled={!canEdit}
            onChange={(v) => onFlagChange(agent.id, v)}
            size="lg"
          />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 mb-2.5">
        <div className="min-w-0">
          {agentUnitKeys(agent).length > 0 ? (
            <UnitBadges agent={agent} unitsByKey={unitsByKey} maxVisible={3} />
          ) : (
            <span className="text-[11px] text-[#808080]">—</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 justify-self-end whitespace-nowrap pt-[3px]">
          <span className={cn('h-[6px] w-[6px] rounded-full shrink-0', getStatusDot(agent.status))} />
          <span className="text-[11.5px] text-[#a6a6a6]">{getStatusLabel(agent.status)}</span>
        </span>
        <div className="col-span-2 flex items-center gap-2">
          <DiscordMemberBadge agent={agent} compact />
          <span className="text-[11.5px] text-[#a6a6a6]">
            Zuletzt online: {agent.lastOnline ? formatRelativeTime(agent.lastOnline) : 'Nie'}
          </span>
          <span className="text-[11.5px] text-[#a6a6a6]">{formatDate(agent.hireDate)}</span>
          {agent.notes && <StickyNote size={11} className="text-[#808080]" strokeWidth={1.75} />}
        </div>
      </div>

      {allTrainings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTrainings.map((t) => {
            const ot = agent.trainings.find((x) => x.trainingId === t.id)
            const completed = ot?.completed || false
            const available = trainingAvailableForAgent(t, agent)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTrainToggle(agent.id, t.id, !completed)}
                disabled={!canEditTrainings}
                title={!available ? `${t.label} ist erst ab ${t.minRank?.name ?? 'Mindestrang'} vorgesehen` : t.label}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[10.5px] font-medium border transition-colors',
                  completed
                    ? 'bg-[#d4d4d4]/15 border-[#d4d4d4]/40 text-[#e6d27a]'
                    : available
                      ? 'bg-[#1d1d1d] border-[#343434]/60 text-[#909090]'
                      : 'bg-[#080808] border-dashed border-[#808080]/50 text-[#808080]',
                  canEditTrainings ? 'hover:border-[#404040]' : 'cursor-not-allowed opacity-70'
                )}
              >
                <span
                  className={cn(
                    'h-[10px] w-[10px] rounded-[3px] flex items-center justify-center',
                    completed ? 'bg-[#d4d4d4]' : 'bg-[#343434]'
                  )}
                >
                  {completed && <Check size={7} className="text-[#1d1d1d]" strokeWidth={3} />}
                </span>
                {t.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AgentsPage() {
  const { addToast } = useToast()
  const { user } = useAuth()
  const canView = hasPermission(user, 'agents:view')
  const canEdit = hasPermission(user, 'agents:write')
  const canEditTrainings = hasPermission(user, 'agent-trainings:manage')
  const canMove = hasPermission(user, 'rank-changes:manage')
  const { data: agents, loading, refetch, setData } = useFetch<Agent[]>(canView ? '/api/agents' : null)
  const { data: ranks } = useFetch<Rank[]>(canView ? '/api/ranks' : null)
  const { data: units } = useFetch<Unit[]>(canView ? '/api/units?active=true' : null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [rankFilter, setRankFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [flagFilter, setFlagFilter] = useState('')
  const [collapsedRanks, setCollapsedRanks] = useState<Set<string>>(new Set())
  const [movePending, setMovePending] = useState(false)
  const [pendingTrainingOverride, setPendingTrainingOverride] = useState<{
    agent: Agent
    training: Training
    completed: boolean
  } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const filteredAgents = useMemo(() => {
    if (!agents) return []
    return agents.filter((o) => {
      if (search) {
        const trimmedSearch = search.trim()
        const s = trimmedSearch.toLowerCase()
        const canSearchDiscordId = /^\d{17,22}$/.test(trimmedSearch)
        if (
          !o.firstName.toLowerCase().includes(s) &&
          !o.lastName.toLowerCase().includes(s) &&
          !o.badgeNumber.toLowerCase().includes(s) &&
          !(canSearchDiscordId && o.discordId?.toLowerCase().includes(s))
        )
          return false
      }
      if (statusFilter && o.status !== statusFilter) return false
      if (rankFilter && o.rankId !== rankFilter) return false
      if (unitFilter) {
        const agentUnits = agentUnitKeys(o)
        if (unitFilter === '__none__' ? agentUnits.length > 0 : !agentUnits.includes(unitFilter)) return false
      }
      if (flagFilter) {
        if (flagFilter === '__any__' ? !o.flag : o.flag !== flagFilter) return false
      }
      return true
    })
  }, [agents, search, statusFilter, rankFilter, unitFilter, flagFilter])

  const unitsByKey = useMemo(() => new Map((units ?? []).map((unit) => [unit.key, unit])), [units])

  const groupedByRank = useMemo(() => {
    const groups: Map<string, { rank: Rank; agents: Agent[] }> = new Map()
    const showEmptyRanks = !search.trim() && !statusFilter && !unitFilter && !flagFilter
    if (showEmptyRanks) {
      for (const rank of ranks ?? []) {
        if (rankFilter && rank.id !== rankFilter) continue
        groups.set(rank.id, { rank, agents: [] })
      }
    }
    for (const agent of filteredAgents) {
      const key = agent.rankId
      if (!groups.has(key)) {
        groups.set(key, { rank: agent.rank, agents: [] })
      }
      groups.get(key)!.agents.push(agent)
    }
    const result = Array.from(groups.values()).sort(
      (a, b) => a.rank.sortOrder - b.rank.sortOrder
    )
    for (const group of result) {
      group.agents.sort((a, b) => compareBadgeNumbers(a.badgeNumber, b.badgeNumber))
    }
    return result
  }, [filteredAgents, ranks, rankFilter, search, statusFilter, unitFilter, flagFilter])

  const allTrainings = useMemo(() => {
    if (!agents || agents.length === 0) return []
    const byId = new Map<string, Training>()
    for (const agent of agents) {
      for (const row of agent.trainings) {
        byId.set(row.training.id, row.training)
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [agents])

  const toggleRankCollapse = (rankId: string) => {
    setCollapsedRanks((prev) => {
      const next = new Set(prev)
      if (next.has(rankId)) next.delete(rankId)
      else next.add(rankId)
      return next
    })
  }

  const handleTrainingToggle = useCallback(
    async (agentId: string, trainingId: string, completed: boolean, overrideConfirmed = false) => {
      if (!canEditTrainings) return
      const list = agents
      const o = list?.find((x) => x.id === agentId)
      if (!o) return
      const trainingRow = o.trainings.find((t) => t.trainingId === trainingId)
      if (!trainingRow) return
      const requiresOverride = completed && !trainingAvailableForAgent(trainingRow.training, o)
      if (requiresOverride && !overrideConfirmed) {
        setPendingTrainingOverride({ agent: o, training: trainingRow.training, completed })
        return
      }
      const previousTrainings = o.trainings.map((t) => ({ ...t }))
      setData((prev) => {
        if (!prev) return prev
        return prev.map((row) => {
          if (row.id !== agentId) return row
          return {
            ...row,
            trainings: row.trainings.map((t) =>
              t.trainingId === trainingId ? { ...t, completed } : t
            ),
          }
        })
      })
      const trainings = o.trainings.map((t) => ({
        trainingId: t.trainingId,
        completed: t.trainingId === trainingId ? completed : t.completed,
      }))
      try {
        const res = await fetch(`/api/agents/${agentId}/trainings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainings,
            overrideTrainingIds: requiresOverride && overrideConfirmed ? [trainingId] : [],
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Fehler')
        if (json.data?.agent) {
          setData((prev) => {
            if (!prev) return prev
            return prev.map((row) => (row.id === agentId ? json.data.agent : row))
          })
        }
        notifyLiveUpdate()
      } catch (err) {
        setData((prev) => {
          if (!prev) return prev
          return prev.map((row) =>
            row.id === agentId ? { ...row, trainings: previousTrainings } : row
          )
        })
        addToast({
          type: 'error',
          title: 'Fehler beim Aktualisieren',
          message: err instanceof Error ? err.message : '',
        })
      }
    },
    [canEditTrainings, agents, setData, addToast]
  )

  const handleFlagChange = useCallback(
    async (agentId: string, flag: string | null) => {
      const previous = agents?.find((x) => x.id === agentId)?.flag ?? null
      setData((prev) => {
        if (!prev) return prev
        return prev.map((row) => (row.id === agentId ? { ...row, flag } : row))
      })
      try {
        const res = await fetch(`/api/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flag }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Fehler')
        notifyLiveUpdate()
      } catch (e) {
        setData((prev) => {
          if (!prev) return prev
          return prev.map((row) => (row.id === agentId ? { ...row, flag: previous } : row))
        })
        addToast({
          type: 'error',
          title: 'Markierung konnte nicht gespeichert werden',
          message: e instanceof Error ? e.message : '',
        })
      }
    },
    [agents, setData, addToast]
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const aid = String(active.id)
      const oid = String(over.id)
      if (!aid.startsWith('drag-') || !oid.startsWith('drop-')) return
      const agentId = aid.slice(5)
      const targetRankId = oid.slice(5)
      const o = agents?.find((x) => x.id === agentId)
      if (!o || o.rankId === targetRankId) return
      setMovePending(true)
      try {
        const res = await fetch(`/api/agents/${agentId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetRankId }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Fehler')
        setData((prev) => {
          if (!prev) return prev
          return prev.map((row) => (row.id === agentId ? json.data : row))
        })
        notifyLiveUpdate()
        addToast({ type: 'success', title: 'Rang & Dienstnummer aktualisiert' })
      } catch (e) {
        addToast({
          type: 'error',
          title: 'Verschieben fehlgeschlagen',
          message: e instanceof Error ? e.message : '',
        })
        await refetch()
      } finally {
        setMovePending(false)
      }
    },
    [agents, setData, addToast, refetch]
  )

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  const filterClass =
    'h-[36px] sm:h-[34px] px-3 rounded-[8px] text-[13px] bg-[#1d1d1d] text-[#c3c3c3] border border-[#343434]/50 focus:outline-none focus:border-[#d4d4d4] transition-all'
  const totalActive = agents?.filter((o) => o.status === 'ACTIVE').length || 0
  const totalAway = agents?.filter((o) => o.status === 'AWAY').length || 0
  const totalFlagged = agents?.filter((o) => o.flag).length || 0

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Agents"
        description={
          canMove
            ? `${filteredAgents.length} Mitarbeiter · ${totalActive} aktiv · ${totalAway} abgemeldet${totalFlagged ? ` · ${totalFlagged} markiert` : ''} · Ziehen: Rang wechseln`
            : `${filteredAgents.length} Mitarbeiter · ${totalActive} aktiv · ${totalAway} abgemeldet${totalFlagged ? ` · ${totalFlagged} markiert` : ''}`
        }
        action={canEdit ? (
          <Link href="/agents/new" className="block sm:inline-block">
            <Button size="sm" disabled={movePending} className="w-full sm:w-auto">
              <Plus size={14} strokeWidth={2} />
              Hinzufügen
            </Button>
          </Link>
        ) : undefined}
      />

      <div className="flex flex-col gap-2 mb-5 sm:mb-6">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#808080]"
            strokeWidth={1.75}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche nach Name, Dienstnummer oder Discord-ID..."
            className={cn(filterClass, 'w-full pl-9 placeholder:text-[#808080]')}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select
            size="sm"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: '', label: 'Alle Status' },
              { value: 'ACTIVE', label: 'Aktiv' },
              { value: 'AWAY', label: 'Abgemeldet' },
              { value: 'INACTIVE', label: 'Inaktiv' },
            ]}
          />

          <Select
            size="sm"
            value={rankFilter}
            onValueChange={setRankFilter}
            options={[
              { value: '', label: 'Alle Ränge' },
              ...(ranks?.map((r) => ({ value: r.id, label: r.name })) || []),
            ]}
          />

          <Select
            size="sm"
            value={unitFilter}
            onValueChange={setUnitFilter}
            options={[
              { value: '', label: 'Alle Units' },
              { value: '__none__', label: 'Ohne Unit' },
              ...(units?.map((u) => ({ value: u.key, label: u.name })) || []),
            ]}
          />

          <Select
            size="sm"
            value={flagFilter}
            onValueChange={setFlagFilter}
            options={[
              { value: '', label: 'Alle Markierungen' },
              { value: '__any__', label: 'Markiert' },
              ...AGENT_FLAG_VALUES.map((f) => ({ value: f, label: getFlagLabel(f) })),
            ]}
          />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragEnd={canMove ? handleDragEnd : () => {}}
        collisionDetection={rankDropCollision}
      >
        <div className="w-full min-w-0 rounded-[12px] overflow-hidden">
          {groupedByRank.length === 0 && (
            <div className="text-center py-24">
              <Users size={28} className="mx-auto text-[#808080] mb-3" strokeWidth={1.5} />
              <p className="text-[13px] text-[#a6a6a6]">Keine Ränge gefunden</p>
            </div>
          )}

          {groupedByRank.map(({ rank, agents: groupAgents }, groupIndex) => {
            const isCollapsed = collapsedRanks.has(rank.id)
            return (
              <div key={rank.id} className={cn('w-full min-w-0', groupIndex > 0 && 'mt-1')}>
                <DropRankZone rankId={rank.id} canHighlight={canMove}>
                  <button
                    type="button"
                    onClick={() => toggleRankCollapse(rank.id)}
                    className="w-full flex items-center gap-2.5 px-3 sm:px-4 py-2 rounded-[8px] hover:bg-[#212121] transition-colors group"
                  >
                    <ChevronDown
                      size={14}
                      strokeWidth={2}
                      className={cn('text-[#808080] transition-transform duration-200 shrink-0', isCollapsed && '-rotate-90')}
                    />
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: rank.color }} />
                    <span className="truncate text-[13px] font-semibold text-[#eee]">{rank.name}</span>
                    <RankNumberBadge number={rank.internalNumber} />
                    <span className="text-[12px] text-[#808080] font-normal shrink-0">{groupAgents.length}</span>
                    {rank.badgeMin != null && rank.badgeMax != null && (
                      <span className="hidden sm:inline text-[10px] text-[#808080] ml-auto font-mono">
                        DN {formatBadgeNumber(rank.badgeMin, '')}–{formatBadgeNumber(rank.badgeMax, '')}
                      </span>
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        {/* Desktop / tablet: table view */}
                        <div className="hidden lg:block glass-panel rounded-[10px] overflow-hidden mt-1 mb-2">
                          <table className="w-full table-fixed">
                            <thead>
                              <tr>
                                <th className="w-[3px] p-0" />
                                <th className="w-[28px] px-1 py-2.5" />
                                <th className="w-[58px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">DN</th>
                                <th className="w-[170px] px-3 py-2.5 text-left text-[11px] font-medium text-[#909090]">Name</th>
                                {allTrainings.map((t) => (
                                  <th
                                    key={t.id}
                                    className="px-1.5 py-2.5 text-center text-[10.5px] font-medium text-[#909090]"
                                    title={t.label}
                                  >
                                    <span className="block mx-auto max-w-full whitespace-normal break-words leading-tight">
                                      {t.label}
                                    </span>
                                  </th>
                                ))}
                                <th className="w-[96px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">Unit</th>
                                <th className="w-[104px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">Status</th>
                                <th className="w-[112px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">Discord</th>
                                <th className="w-[104px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">Zuletzt Online</th>
                                <th className="w-[96px] px-2 py-2.5 text-left text-[11px] font-medium text-[#909090]">Einstellung</th>
                                <th className="w-[44px] px-1.5 py-2.5 text-center text-[11px] font-medium text-[#909090]">
                                  <Flag size={11} className="inline" strokeWidth={1.75} />
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupAgents.length > 0 ? (
                                groupAgents.map((agent, i) => (
                                  <DraggableAgentRow
                                    key={agent.id}
                                    agent={agent}
                                    canDrag={canMove}
                                    canEdit={canEdit}
                                    canEditTrainings={canEditTrainings}
                                    allTrainings={allTrainings}
                                    unitsByKey={unitsByKey}
                                    rowIndex={i}
                                    onTrainToggle={handleTrainingToggle}
                                    onFlagChange={handleFlagChange}
                                  />
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={10 + allTrainings.length} className="px-4 py-4 text-center text-[12.5px] text-[#909090]">
                                    — Kein Agent hat diesen Rang
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile / tablet: card view */}
                        <div className="lg:hidden w-full min-w-0 mt-1 mb-2 space-y-1.5">
                          {groupAgents.length > 0 ? (
                            groupAgents.map((agent) => (
                              <MobileAgentCard
                                key={agent.id}
                                agent={agent}
                                allTrainings={allTrainings}
                                unitsByKey={unitsByKey}
                                canEdit={canEdit}
                                canEditTrainings={canEditTrainings}
                                onTrainToggle={handleTrainingToggle}
                                onFlagChange={handleFlagChange}
                              />
                            ))
                          ) : (
                            <div className="rounded-[10px] border border-dashed border-[#343434]/70 bg-[#181818]/40 px-3.5 py-3 text-center text-[12.5px] text-[#909090]">
                              — Kein Agent hat diesen Rang
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </DropRankZone>
              </div>
            )
          })}
        </div>
      </DndContext>

      <Modal
        open={!!pendingTrainingOverride}
        onClose={() => setPendingTrainingOverride(null)}
        title="Ausbildung außerhalb des Mindestrangs"
      >
        {pendingTrainingOverride && (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#d4d4d4]/25 bg-[#1d1608]/60 px-3.5 py-3">
              <p className="text-[13px] font-medium text-[#f4f4f4]">
                {pendingTrainingOverride.training.label}
              </p>
              <p className="mt-1 text-[12.5px] text-[#aeaeae]">
                Vorgesehen ab: {pendingTrainingOverride.training.minRank?.name ?? 'Mindestrang'}
              </p>
            </div>
            <div className="rounded-[10px] border border-[#343434]/70 bg-[#181818]/70 px-3.5 py-3">
              <p className="text-[12px] text-[#a6a6a6]">Agent</p>
              <p className="mt-1 text-[14px] font-semibold text-white">
                {pendingTrainingOverride.agent.firstName} {pendingTrainingOverride.agent.lastName}
              </p>
              <p className="mt-1 text-[12.5px] text-[#aeaeae]">
                DN {displayBadgeNumber(pendingTrainingOverride.agent.badgeNumber)} · {pendingTrainingOverride.agent.rank.name}
              </p>
            </div>
            <p className="text-[13px] leading-relaxed text-[#aeaeae]">
              Möchtest du diese Ausbildung wirklich exakt diesem Agent geben?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setPendingTrainingOverride(null)}>
                Abbrechen
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const pending = pendingTrainingOverride
                  setPendingTrainingOverride(null)
                  void handleTrainingToggle(pending.agent.id, pending.training.id, pending.completed, true)
                }}
              >
                Bestätigen
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
