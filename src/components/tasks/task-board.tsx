'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  ChevronDown,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  Calendar,
  Flag,
  CircleDot,
  Loader2,
  CheckCircle2,
  ListChecks,
  UserPlus,
  X,
  AlertCircle,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ColorField } from '@/components/ui/color-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { DateField } from '@/components/ui/date-field'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { cn, formatDate } from '@/lib/utils'
import { hasPermission, type Permission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'

type TaskModule = 'ACADEMY' | 'HR' | 'SRU' | 'AIR_SUPPORT' | 'DETECTIVE' | 'INTERNAL_AFFAIRS' | 'LAD'
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED'
type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

interface AgentLite {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank: { id: string; name: string; color: string } | null
}

type AssignmentAgent = AgentLite

interface TaskAssignment {
  id: string
  agent: AssignmentAgent
}

interface TaskItem {
  id: string
  listId: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  completedAt: string | null
  sortOrder: number
  createdAt: string
  createdBy: { id: string; displayName: string } | null
  assignments: TaskAssignment[]
}

interface TaskList {
  id: string
  module: TaskModule
  title: string
  description: string | null
  color: string
  archived: boolean
  sortOrder: number
  createdAt: string
  createdBy: { id: string; displayName: string } | null
  tasks: TaskItem[]
}

interface AgentForPicker {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  status: string
  rank: { id: string; name: string; color: string }
}

interface TaskBoardProps {
  module: TaskModule
  title: string
  description: string
  accentLabel: string
  viewPermission?: Permission
  managePermission?: Permission
  headerAction?: ReactNode
}

const PRIORITY_META: Record<TaskPriority, { label: string; tone: string; dot: string }> = {
  LOW: { label: 'Niedrig', tone: 'text-[#919191] bg-[#232323]/70 border-[#404040]/60', dot: 'bg-[#919191]' },
  NORMAL: { label: 'Normal', tone: 'text-[#aeaeae] bg-[#232323]/70 border-[#404040]/60', dot: 'bg-[#60a5fa]' },
  HIGH: { label: 'Hoch', tone: 'text-[#fbbf24] bg-[#3a2c10]/50 border-[#fbbf24]/30', dot: 'bg-[#fbbf24]' },
  URGENT: { label: 'Dringend', tone: 'text-[#fca5a5] bg-[#321218]/60 border-[#f87171]/30', dot: 'bg-[#f87171]' },
}

const STATUS_META: Record<TaskStatus, { label: string; icon: LucideIcon; tone: string }> = {
  OPEN: { label: 'Offen', icon: CircleDot, tone: 'text-[#aeaeae]' },
  IN_PROGRESS: { label: 'In Arbeit', icon: Loader2, tone: 'text-[#60a5fa]' },
  COMPLETED: { label: 'Erledigt', icon: CheckCircle2, tone: 'text-[#34d399]' },
}

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  OPEN: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
  COMPLETED: 'OPEN',
}

interface ListFormState {
  title: string
  description: string
  color: string
}

interface TaskFormState {
  title: string
  description: string
  priority: TaskPriority
  dueDate: string
  assigneeIds: string[]
}

const EMPTY_LIST_FORM: ListFormState = { title: '', description: '', color: '#d4d4d4' }
const EMPTY_TASK_FORM: TaskFormState = {
  title: '',
  description: '',
  priority: 'NORMAL',
  dueDate: '',
  assigneeIds: [],
}

const COLOR_PRESETS = ['#d4d4d4', '#60a5fa', '#34d399', '#f87171', '#a78bfa', '#fbbf24']

function agentLabel(o: AgentLite | AgentForPicker) {
  return `${o.firstName} ${o.lastName}`
}

function isOverdue(dueDate: string | null, status: TaskStatus) {
  if (!dueDate || status === 'COMPLETED') return false
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function StatChip({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <div className="glass-panel-elevated rounded-[12px] px-4 py-3 flex items-center gap-3 border border-white/[0.04]">
      <div className={cn('h-9 w-9 rounded-[10px] flex items-center justify-center', tone)}>
        <Icon size={16} strokeWidth={1.85} />
      </div>
      <div className="min-w-0">
        <p className="text-[20px] font-semibold text-white tabular-nums leading-tight">{value}</p>
        <p className="text-[11px] text-[#a6a6a6] mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function AssigneePill({ agent, onRemove }: { agent: AssignmentAgent; onRemove?: () => void }) {
  const initials = `${agent.firstName.charAt(0)}${agent.lastName.charAt(0)}`.toUpperCase()
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-[#212121] border border-[#373737]/60 text-[11.5px] text-[#e5e5e5]">
      <span
        className="h-4 w-4 rounded-full flex items-center justify-center text-[8.5px] font-bold text-[#181818]"
        style={{ backgroundColor: agent.rank?.color || '#d4d4d4' }}
      >
        {initials}
      </span>
      <Link
        href={`/agents/${agent.id}`}
        className="hover:text-[#d4d4d4] transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {agentLabel(agent)} <span className="text-[10px] text-[#909090] font-mono">#{displayBadgeNumber(agent.badgeNumber)}</span>
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="text-[#909090] hover:text-red-400 transition-colors"
          aria-label="Entfernen"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </span>
  )
}

interface AssigneeManagerProps {
  agents: AgentForPicker[]
  selected: string[]
  onChange: (ids: string[]) => void
}

function AssigneeManager({ agents, selected, onChange }: AssigneeManagerProps) {
  const [search, setSearch] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim()
    return agents
      .filter((o) => o.status !== 'TERMINATED')
      .filter((o) => {
        if (!s) return true
        return (
          o.firstName.toLowerCase().includes(s) ||
          o.lastName.toLowerCase().includes(s) ||
          o.badgeNumber.toLowerCase().includes(s) ||
          o.rank.name.toLowerCase().includes(s)
        )
      })
      .slice(0, 60)
  }, [agents, search])

  const selectedAgents = useMemo(
    () => agents.filter((o) => selectedSet.has(o.id)),
    [agents, selectedSet],
  )

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter((s) => s !== id))
    else onChange([...selected, id])
  }

  return (
    <div className="space-y-2">
      <label className="block text-[12.5px] font-medium text-[#aeaeae]">Zugewiesene Mitarbeiter</label>
      {selectedAgents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedAgents.map((o) => (
            <AssigneePill key={o.id} agent={o} onRemove={() => toggle(o.id)} />
          ))}
        </div>
      )}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[#808080]"
          strokeWidth={1.75}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Agent suchen…"
          className="w-full h-[34px] pl-9 pr-3 rounded-[8px] text-[13px] bg-[#181818]/60 text-[#f4f4f4] border border-[#343434]/70 focus:outline-none focus:border-[#d4d4d4] placeholder:text-[#808080] transition-all"
        />
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-[10px] border border-[#343434]/40 bg-[#181818]/40">
        {filtered.length === 0 ? (
          <p className="text-[12px] text-[#909090] text-center py-6">Keine Agents gefunden</p>
        ) : (
          <ul className="divide-y divide-[#343434]/30">
            {filtered.map((o) => {
              const checked = selectedSet.has(o.id)
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => toggle(o.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                      checked ? 'bg-[#d4d4d4]/8' : 'hover:bg-[#232323]/60',
                    )}
                  >
                    <span
                      className={cn(
                        'h-[16px] w-[16px] rounded-[4px] flex items-center justify-center transition-all',
                        checked
                          ? 'bg-gradient-to-b from-[#d4d4d4] to-[#b8b8b8] text-[#181818]'
                          : 'border border-[#464646]',
                      )}
                    >
                      {checked && <CheckCircle2 size={11} strokeWidth={3} />}
                    </span>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: o.rank.color }}
                    />
                    <span className="flex-1 min-w-0 truncate text-[13px] text-[#f4f4f4]">
                      {agentLabel(o)}
                      <span className="text-[#909090] font-mono ml-1.5 text-[11px]">#{displayBadgeNumber(o.badgeNumber)}</span>
                    </span>
                    <span className="text-[11px] text-[#909090] truncate max-w-[120px]">{o.rank.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export function TaskBoard({
  module,
  title,
  description,
  accentLabel,
  viewPermission,
  managePermission,
  headerAction,
}: TaskBoardProps) {
  const { user } = useAuth()
  const canView = viewPermission ? hasPermission(user, viewPermission) : false
  const canEdit = managePermission ? hasPermission(user, managePermission) : false

  const [showArchived, setShowArchived] = useState(false)
  const queryUrl = canView ? `/api/task-lists?module=${module}${showArchived ? '&archived=true' : ''}` : null

  const { data: lists, loading, refetch, setData } = useFetch<TaskList[]>(queryUrl)
  const { data: agents } = useFetch<AgentForPicker[]>(canEdit ? '/api/agents' : null)
  const { execute } = useApi()
  const { addToast } = useToast()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [listModalOpen, setListModalOpen] = useState(false)
  const [editingList, setEditingList] = useState<TaskList | null>(null)
  const [listForm, setListForm] = useState<ListFormState>(EMPTY_LIST_FORM)

  const [taskModalListId, setTaskModalListId] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormState>(EMPTY_TASK_FORM)
  const [submitting, setSubmitting] = useState(false)

  const stats = useMemo(() => {
    if (!lists) return { total: 0, open: 0, progress: 0, completed: 0, overdue: 0 }
    let open = 0
    let progress = 0
    let completed = 0
    let overdue = 0
    let total = 0
    for (const list of lists) {
      if (list.archived) continue
      for (const t of list.tasks) {
        total += 1
        if (t.status === 'OPEN') open += 1
        else if (t.status === 'IN_PROGRESS') progress += 1
        else if (t.status === 'COMPLETED') completed += 1
        if (isOverdue(t.dueDate, t.status)) overdue += 1
      }
    }
    return { total, open, progress, completed, overdue }
  }, [lists])

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreateList = () => {
    setEditingList(null)
    setListForm(EMPTY_LIST_FORM)
    setListModalOpen(true)
  }

  const openEditList = (list: TaskList) => {
    setEditingList(list)
    setListForm({
      title: list.title,
      description: list.description ?? '',
      color: list.color || '#d4d4d4',
    })
    setListModalOpen(true)
  }

  const submitList = async () => {
    const trimmedTitle = listForm.title.trim()
    if (!trimmedTitle) {
      addToast({ type: 'error', title: 'Titel fehlt' })
      return
    }
    setSubmitting(true)
    try {
      if (editingList) {
        await execute(`/api/task-lists/${editingList.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: trimmedTitle,
            description: listForm.description,
            color: listForm.color,
          }),
        })
        addToast({ type: 'success', title: 'Liste aktualisiert' })
      } else {
        await execute('/api/task-lists', {
          method: 'POST',
          body: JSON.stringify({
            module,
            title: trimmedTitle,
            description: listForm.description,
            color: listForm.color,
          }),
        })
        addToast({ type: 'success', title: 'Liste erstellt' })
      }
      setListModalOpen(false)
      setEditingList(null)
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  const archiveList = async (list: TaskList) => {
    try {
      await execute(`/api/task-lists/${list.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: !list.archived }),
      })
      addToast({
        type: 'success',
        title: list.archived ? 'Liste reaktiviert' : 'Liste archiviert',
      })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    }
  }

  const deleteList = async (list: TaskList) => {
    if (!confirm(`Liste "${list.title}" mit allen Aufgaben wirklich löschen?`)) return
    try {
      await execute(`/api/task-lists/${list.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Liste gelöscht' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    }
  }

  const openCreateTask = (listId: string) => {
    setEditingTask(null)
    setTaskModalListId(listId)
    setTaskForm(EMPTY_TASK_FORM)
  }

  const openEditTask = (task: TaskItem) => {
    setEditingTask(task)
    setTaskModalListId(task.listId)
    setTaskForm({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      assigneeIds: task.assignments.map((a) => a.agent.id),
    })
  }

  const closeTaskModal = () => {
    setTaskModalListId(null)
    setEditingTask(null)
  }

  const submitTask = async () => {
    if (!taskModalListId) return
    const trimmedTitle = taskForm.title.trim()
    if (!trimmedTitle) {
      addToast({ type: 'error', title: 'Titel fehlt' })
      return
    }
    setSubmitting(true)
    try {
      if (editingTask) {
        await execute(`/api/tasks/${editingTask.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: trimmedTitle,
            description: taskForm.description,
            priority: taskForm.priority,
            dueDate: taskForm.dueDate || null,
          }),
        })
        await execute(`/api/tasks/${editingTask.id}/assignees`, {
          method: 'PUT',
          body: JSON.stringify({ agentIds: taskForm.assigneeIds }),
        })
        addToast({ type: 'success', title: 'Aufgabe aktualisiert' })
      } else {
        await execute(`/api/task-lists/${taskModalListId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({
            title: trimmedTitle,
            description: taskForm.description,
            priority: taskForm.priority,
            dueDate: taskForm.dueDate || null,
            assigneeIds: taskForm.assigneeIds,
          }),
        })
        addToast({ type: 'success', title: 'Aufgabe erstellt' })
      }
      closeTaskModal()
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  const cycleStatus = async (task: TaskItem) => {
    const next = NEXT_STATUS[task.status]
    setData((prev) => {
      if (!prev) return prev
      return prev.map((list) =>
        list.id === task.listId
          ? {
              ...list,
              tasks: list.tasks.map((t) =>
                t.id === task.id
                  ? { ...t, status: next, completedAt: next === 'COMPLETED' ? new Date().toISOString() : null }
                  : t,
              ),
            }
          : list,
      )
    })
    try {
      await execute(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      })
    } catch (e) {
      await refetch()
      addToast({ type: 'error', title: 'Status nicht aktualisiert', message: e instanceof Error ? e.message : '' })
    }
  }

  const deleteTask = async (task: TaskItem) => {
    if (!confirm(`Aufgabe "${task.title}" löschen?`)) return
    try {
      await execute(`/api/tasks/${task.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Aufgabe gelöscht' })
      await refetch()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    }
  }

  if (!canView) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  const visibleLists = lists ?? []

  return (
    <div className="max-w-6xl mx-auto pb-2">
      <PageHeader
        title={title}
        description={description}
        action={
          headerAction || canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {headerAction}
              {canEdit && (
                <Button size="sm" onClick={openCreateList}>
                  <Plus size={14} strokeWidth={2} />
                  Neue Liste
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatChip icon={ListChecks} label="Aufgaben" value={stats.total} tone="bg-[#d4d4d4]/15 text-[#d4d4d4]" />
        <StatChip icon={CircleDot} label="Offen" value={stats.open} tone="bg-[#373737]/40 text-[#aeaeae]" />
        <StatChip icon={Loader2} label="In Arbeit" value={stats.progress} tone="bg-[#373737]/50 text-[#60a5fa]" />
        <StatChip icon={CheckCircle2} label="Erledigt" value={stats.completed} tone="bg-[#0f3a2a]/50 text-[#34d399]" />
        <StatChip icon={AlertCircle} label="Überfällig" value={stats.overdue} tone="bg-[#3a1818]/50 text-[#f87171]" />
      </div>

      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#808080] font-semibold">{accentLabel}</p>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium border transition-colors',
              showArchived
                ? 'bg-[#d4d4d4]/12 border-[#d4d4d4]/35 text-[#d4d4d4]'
                : 'bg-[#181818]/60 border-[#343434]/60 text-[#a6a6a6] hover:text-white hover:border-[#404040]',
            )}
          >
            {showArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
            {showArchived ? 'Archiv ausblenden' : 'Archiv zeigen'}
          </button>
        )}
      </div>

      {visibleLists.length === 0 ? (
        <div className="glass-panel-elevated rounded-[14px] py-16 text-center border border-white/[0.04]">
          <ListChecks size={28} className="mx-auto text-[#808080] mb-3" strokeWidth={1.5} />
          <p className="text-[13px] text-[#aeaeae] mb-4">Noch keine Listen vorhanden</p>
          {canEdit && (
            <Button size="sm" onClick={openCreateList}>
              <Plus size={14} strokeWidth={2} />
              Erste Liste anlegen
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3.5">
          {visibleLists.map((list) => {
            const isCollapsed = collapsed.has(list.id)
            const completedCount = list.tasks.filter((t) => t.status === 'COMPLETED').length
            const totalCount = list.tasks.length
            const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

            return (
              <motion.section
                key={list.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={cn(
                  'glass-panel-elevated rounded-[14px] border overflow-hidden',
                  list.archived
                    ? 'border-[#404040]/40 opacity-80'
                    : 'border-[#373737]/40 shadow-sm shadow-black/10',
                )}
              >
                <div
                  className="flex items-start gap-3 px-4 py-3.5"
                  style={{
                    background: `linear-gradient(90deg, ${list.color}10 0%, transparent 60%)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapse(list.id)}
                    className="mt-1 p-1 rounded-md text-[#909090] hover:text-[#d4d4d4] transition-colors"
                    aria-label={isCollapsed ? 'Liste ausklappen' : 'Liste einklappen'}
                  >
                    <ChevronDown
                      size={14}
                      strokeWidth={2}
                      className={cn('transition-transform duration-200', isCollapsed && '-rotate-90')}
                    />
                  </button>

                  <span
                    className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: list.color }}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-[14px] font-semibold text-white tracking-[-0.01em]">{list.title}</h3>
                      {list.archived && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.12em] text-[#909090] bg-[#181818]/60 px-2 py-0.5 rounded-full border border-[#343434]/60">
                          <Archive size={9} /> Archiv
                        </span>
                      )}
                      <span className="text-[11.5px] text-[#919191]">
                        {completedCount}/{totalCount} erledigt
                      </span>
                    </div>
                    {list.description && (
                      <p className="text-[12.5px] text-[#aeaeae] mt-0.5 leading-relaxed">{list.description}</p>
                    )}
                    {totalCount > 0 && (
                      <div className="mt-2.5 h-[5px] w-full max-w-[420px] bg-[#232323]/80 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: list.color }}
                        />
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openCreateTask(list.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-[7px] text-[11.5px] font-medium text-[#d4d4d4] hover:bg-[#d4d4d4]/10 transition-colors"
                      >
                        <Plus size={12} strokeWidth={2.2} />
                        Aufgabe
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditList(list)}
                        className="p-1.5 rounded-[7px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/50 transition-colors"
                        aria-label="Liste bearbeiten"
                      >
                        <Pencil size={12} strokeWidth={1.85} />
                      </button>
                      <button
                        type="button"
                        onClick={() => archiveList(list)}
                        className="p-1.5 rounded-[7px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/50 transition-colors"
                        aria-label={list.archived ? 'Reaktivieren' : 'Archivieren'}
                      >
                        {list.archived ? (
                          <ArchiveRestore size={12} strokeWidth={1.85} />
                        ) : (
                          <Archive size={12} strokeWidth={1.85} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteList(list)}
                        className="p-1.5 rounded-[7px] text-[#909090] hover:text-red-400 hover:bg-[#321218]/40 transition-colors"
                        aria-label="Liste löschen"
                      >
                        <Trash2 size={12} strokeWidth={1.85} />
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[#343434]/40">
                        {list.tasks.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-8 text-center">
                            <ListChecks size={20} className="text-[#808080] mb-2" strokeWidth={1.5} />
                            <p className="text-[12.5px] text-[#919191]">Noch keine Aufgaben</p>
                          </div>
                        ) : (
                          <ul className="divide-y divide-[#343434]/30">
                            {list.tasks.map((task) => {
                              const status = STATUS_META[task.status]
                              const StatusIcon = status.icon
                              const priority = PRIORITY_META[task.priority]
                              const overdue = isOverdue(task.dueDate, task.status)

                              return (
                                <li
                                  key={task.id}
                                  className={cn(
                                    'flex items-start gap-3 px-4 py-3 hover:bg-[#212121]/50 transition-colors',
                                    task.status === 'COMPLETED' && 'opacity-75',
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => canEdit && cycleStatus(task)}
                                    disabled={!canEdit}
                                    className={cn(
                                      'mt-0.5 h-6 w-6 rounded-full flex items-center justify-center transition-all duration-150 shrink-0 border',
                                      task.status === 'COMPLETED'
                                        ? 'bg-gradient-to-b from-[#34d399] to-[#10b981] border-emerald-500/50 text-[#04200f]'
                                        : task.status === 'IN_PROGRESS'
                                          ? 'bg-[#373737]/60 border-[#60a5fa]/50 text-[#60a5fa]'
                                          : 'bg-[#181818] border-[#404040]/70 text-[#919191] hover:border-[#d4d4d4]/40',
                                      !canEdit && 'cursor-not-allowed',
                                    )}
                                    aria-label="Status ändern"
                                  >
                                    <StatusIcon
                                      size={12}
                                      strokeWidth={2.4}
                                      className={cn(task.status === 'IN_PROGRESS' && 'animate-spin')}
                                    />
                                  </button>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <p
                                        className={cn(
                                          'text-[13px] font-medium text-white',
                                          task.status === 'COMPLETED' && 'line-through text-[#919191]',
                                        )}
                                      >
                                        {task.title}
                                      </p>
                                      <span
                                        className={cn(
                                          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] text-[10px] font-medium border',
                                          priority.tone,
                                        )}
                                      >
                                        <Flag size={9} strokeWidth={2.2} /> {priority.label}
                                      </span>
                                      {task.dueDate && (
                                        <span
                                          className={cn(
                                            'inline-flex items-center gap-1 text-[11px] font-medium',
                                            overdue ? 'text-[#fca5a5]' : 'text-[#aeaeae]',
                                          )}
                                        >
                                          <Calendar size={10} strokeWidth={1.85} /> {formatDate(task.dueDate)}
                                          {overdue && <AlertCircle size={10} strokeWidth={2} className="text-[#f87171]" />}
                                        </span>
                                      )}
                                      <span className={cn('inline-flex items-center gap-1 text-[11px]', status.tone)}>
                                        {status.label}
                                      </span>
                                    </div>
                                    {task.description && (
                                      <p className="text-[12px] text-[#aeaeae] mt-1 whitespace-pre-wrap leading-relaxed">
                                        {task.description}
                                      </p>
                                    )}
                                    {task.assignments.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {task.assignments.map((a) => (
                                          <AssigneePill key={a.id} agent={a.agent} />
                                        ))}
                                      </div>
                                    )}
                                    <p className="text-[10.5px] text-[#808080] mt-2">
                                      {task.createdBy?.displayName ?? 'Gelöscht'} · erstellt {formatDate(task.createdAt)}
                                    </p>
                                  </div>

                                  {canEdit && (
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => openEditTask(task)}
                                        className="p-1.5 rounded-[7px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/50 transition-colors"
                                        aria-label="Aufgabe bearbeiten"
                                      >
                                        <Pencil size={12} strokeWidth={1.85} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteTask(task)}
                                        className="p-1.5 rounded-[7px] text-[#909090] hover:text-red-400 hover:bg-[#321218]/40 transition-colors"
                                        aria-label="Aufgabe löschen"
                                      >
                                        <Trash2 size={12} strokeWidth={1.85} />
                                      </button>
                                    </div>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            )
          })}
        </div>
      )}

      <Modal
        open={listModalOpen}
        onClose={() => {
          setListModalOpen(false)
          setEditingList(null)
        }}
        title={editingList ? 'Liste bearbeiten' : 'Neue Liste'}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Titel"
            value={listForm.title}
            onChange={(e) => setListForm({ ...listForm, title: e.target.value })}
            placeholder="z. B. Onboarding Cadets"
            required
          />
          <Textarea
            label="Beschreibung (optional)"
            value={listForm.description}
            onChange={(e) => setListForm({ ...listForm, description: e.target.value })}
            rows={3}
            placeholder="Worum geht es bei dieser Liste?"
          />
          <ColorField
            label="Akzentfarbe"
            value={listForm.color}
            onChange={(color) => setListForm({ ...listForm, color })}
            presets={COLOR_PRESETS}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setListModalOpen(false)
                setEditingList(null)
              }}
            >
              Abbrechen
            </Button>
            <Button size="sm" onClick={submitList} loading={submitting} disabled={!listForm.title.trim()}>
              {editingList ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!taskModalListId}
        onClose={closeTaskModal}
        title={editingTask ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Titel"
            value={taskForm.title}
            onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
            placeholder="Was muss erledigt werden?"
            required
          />
          <Textarea
            label="Beschreibung (optional)"
            value={taskForm.description}
            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            rows={3}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Priorität"
              value={taskForm.priority}
              onValueChange={(v) => setTaskForm({ ...taskForm, priority: v as TaskPriority })}
              options={[
                { value: 'LOW', label: 'Niedrig' },
                { value: 'NORMAL', label: 'Normal' },
                { value: 'HIGH', label: 'Hoch' },
                { value: 'URGENT', label: 'Dringend' },
              ]}
            />
            <DateField
              label="Fällig am (optional)"
              value={taskForm.dueDate}
              onChange={(v) => setTaskForm({ ...taskForm, dueDate: v })}
              emptyLabel="Kein Datum"
            />
          </div>
          <AssigneeManager
            agents={agents ?? []}
            selected={taskForm.assigneeIds}
            onChange={(ids) => setTaskForm({ ...taskForm, assigneeIds: ids })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={closeTaskModal}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={submitTask} loading={submitting} disabled={!taskForm.title.trim()}>
              {editingTask ? (
                <>
                  <Pencil size={12} strokeWidth={2} />
                  Speichern
                </>
              ) : (
                <>
                  <UserPlus size={12} strokeWidth={2} />
                  Erstellen
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
