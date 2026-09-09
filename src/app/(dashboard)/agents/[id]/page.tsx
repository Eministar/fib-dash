'use client'

import { useState, useCallback, use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, CalendarPlus, Edit, Trash2, UserX, UserCheck, Save, X, Check, TrendingUp, TrendingDown, Plus, StickyNote, Timer, Send, Gavel, ListPlus, ChevronDown, ChevronUp, History, Download, MessageCircle, CircleSlash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/ui/date-field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { UnitMultiSelect } from '@/components/agents/unit-multi-select'
import { UnitBadges } from '@/components/agents/unit-badges'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import {
  cn,
  formatDate,
  formatDateTime,
  getStatusLabel,
  getStatusDot,
  getFlagLabel,
  getFlagColor,
} from '@/lib/utils'
import { hasPermission, PERMISSIONS } from '@/lib/permissions'
import { agentUnitKeys } from '@/lib/agent-units'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { displayBadgeNumber } from '@/lib/badge-number'
import { AgentAvatar } from '@/components/agents/agent-avatar'
import {
  DECISION_CHECKLIST,
  AGGRAVATING_CIRCUMSTANCES,
  MITIGATING_CIRCUMSTANCES,
  PENAL_GRADE_ORDER,
  PENAL_GRADE_RULES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  isPenalGrade,
  isSanctionLevel,
  penalGradeLabel,
  sanctionLevelLabel,
  violationsForGrade,
} from '@/lib/sanction-catalog'
import { CONTRACT_STATUS_META, type ContractStatusValue } from '@/lib/contracts'
import { SanctionCard, type SanctionRecord } from '@/components/sanctions/sanction-card'
import { Badge } from '@/components/ui/badge'
import { RankNumberBadge } from '@/components/ranks/rank-number-badge'
import { CodenameHistory } from '@/components/codenames/codename-history'

interface Rank { id: string; name: string; sortOrder: number; internalNumber: number | null; color: string }
interface Unit { id: string; key: string; name: string; color: string; active: boolean }
interface Training {
  id: string
  key: string
  label: string
  sortOrder: number
  minRankId: string | null
  minRank: { id: string; name: string; sortOrder: number } | null
}
interface AgentTraining { id: string; trainingId: string; completed: boolean; training: Training }
interface PromotionLog {
  id: string
  note: string | null
  createdAt: string
  oldRank: Rank
  newRank: Rank
  performedBy: { displayName: string } | null
}
interface AgentNote {
  id: string
  title: string | null
  content: string
  createdAt: string
  author: { displayName: string } | null
}
interface AgentDetail {
  id: string
  avatarUrl: string | null
  badgeNumber: string
  firstName: string
  lastName: string
  rankId: string
  rank: Rank
  status: string
  unit: string | null
  units: string[] | null
  flag: string | null
  promotionBlocked: boolean
  notes: string | null
  hireDate: string
  hiredBy?: { displayName: string | null; createdAt: string } | null
  lastOnline: string | null
  discordId: string | null
  discordMember?: {
    checked: boolean
    inGuild: boolean
  }
  trainings: AgentTraining[]
  promotionLogs: PromotionLog[]
  sanctions: SanctionRecord[]
  agentNotes: AgentNote[]
  dutyTime?: {
    activeSession: { id: string; clockInAt: string; currentDurationMs: number } | null
    activePlaySession: { id: string; startedAt: string; currentDurationMs: number; playerName: string; license: string | null; lastSeenAt: string } | null
    weekDurationMs: number
    playtimeWeekDurationMs: number
    totalDurationMs: number
    sessionCount: number
    averageSessionMs: number
    longestSessionMs: number
    lastSeenAt: string | null
  }
  playtime?: {
    daily: Array<{ date: string; label: string; durationMs: number; durationLabel: string }>
    recentSessions: Array<{
      id: string
      startedAt: string
      endedAt: string | null
      lastSeenAt: string
      playerName: string
      license: string | null
      durationMs: number
    }>
  }
  absences?: {
    active: AbsenceNotice | null
    upcoming: AbsenceNotice[]
    recent: AbsenceNotice[]
  }
  contracts?: AgentContract[]
  jobApplication?: LinkedApplication | null
}
interface AgentContract {
  id: string
  title: string
  status: ContractStatusValue
  token: string
  sentAt: string | null
  sentVia: string | null
  sendCount: number
  lastSendError: string | null
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
  declineReason: string | null
  createdAt: string
  template: { id: string; name: string } | null
}
interface LinkedApplication {
  id: string
  applicantDisplayName: string
  status: string
  statusText: string
  submittedAt: string
  discordId: string
}
interface AbsenceNotice {
  id: string
  startsAt: string
  endsAt: string
  reason: string
  source: string
  actorDiscordId: string | null
}
interface AgentForm {
  badgeNumber: string
  firstName: string
  lastName: string
  rankId: string
  notes: string
  status: string
  units: string[]
  flag: string
  hireDate: string
  discordId: string
}
interface SanctionForm {
  penalGrade: string
  level: string
  violationCode: string
  reason: string
  penalty: string
  /** Dauer einer Suspendierung in Stunden (Stufe 05). */
  suspensionHours: string
  mitigating: string[]
  aggravating: string[]
}

/** Antwort von `GET /api/sanctions/repeat-check`. */
interface RepeatAssessment {
  occurrence: number
  principle: string
  regularLevel: string
  recommendedLevel: string
  recommendedLevelLabel: string
  priors: { id: string; penalGrade: string; level: string; reason: string; createdAt: string }[]
  violationLabel: string | null
}
interface RankChangeList {
  id: string
  name: string
  type: string
  status: string
  submissionsClosed: boolean
}

const EMPTY_AGENT_FORM: AgentForm = {
  badgeNumber: '',
  firstName: '',
  lastName: '',
  rankId: '',
  notes: '',
  status: 'ACTIVE',
  units: [],
  flag: '',
  hireDate: '',
  discordId: '',
}

const EMPTY_SANCTION_FORM: SanctionForm = {
  penalGrade: '1',
  level: '01',
  violationCode: '',
  reason: '',
  penalty: '',
  suspensionHours: '48',
  mitigating: [],
  aggravating: [],
}

const PENAL_GRADE_OPTIONS = PENAL_GRADE_ORDER.map((grade) => ({
  value: grade,
  label: penalGradeLabel(grade),
}))

const SANCTION_LEVEL_OPTIONS = SANCTION_LEVEL_ORDER.map((level) => ({
  value: level,
  label: sanctionLevelLabel(level),
}))
const PLAYTIME_HISTORY_COLLAPSE_LIMIT = 5

function trainingAvailableForAgent(training: Training, agent: AgentDetail) {
  return !training.minRank || agent.rank.sortOrder <= training.minRank.sortOrder
}

function DiscordMemberStatus({ agent }: { agent: Pick<AgentDetail, 'discordId' | 'discordMember'> }) {
  const hasDiscordId = !!agent.discordId
  const checked = !!agent.discordMember?.checked
  const inGuild = !!agent.discordMember?.inGuild
  const label = !hasDiscordId
    ? 'Nicht verknüpft'
    : checked
      ? inGuild ? 'Auf Discord-Server' : 'Nicht auf Discord-Server'
      : 'Discord-Server ungeprüft'
  const className = !hasDiscordId || !checked
    ? 'border-[#404040]/50 bg-[#1d1d1d]/70 text-[#909090]'
    : inGuild
      ? 'border-[#166534]/50 bg-[#052e1a]/70 text-[#86efac]'
      : 'border-[#7f1d1d]/55 bg-[#2a1212]/70 text-[#fca5a5]'
  const Icon = hasDiscordId && checked && inGuild ? MessageCircle : CircleSlash

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-[3px] text-[11.5px] font-medium', className)}>
      <Icon size={11} strokeWidth={2} />
      {label}
    </span>
  )
}

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateAfterDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dateInputValue(date)
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { addToast } = useToast()
  const { user } = useAuth()
  const { execute } = useApi()
  const canViewAgent = hasPermission(user, 'agents:view')
  const canEditAgent = hasPermission(user, 'agents:write')
  const globalAdministrator = Boolean(
    user && (
      user.groups.some((group) => ['admin', 'administration', 'administrator'].includes(group.name.toLowerCase())) ||
      PERMISSIONS.every((permission) => user.permissions.includes(permission))
    ),
  )
  const canManageAgentUnits = globalAdministrator || hasPermission(user, 'unit-leadership:manage')
  const canEditTrainings = hasPermission(user, 'agent-trainings:manage')
  const canDeleteAgent = hasPermission(user, 'agents:delete')
  const canBlockPromotion = hasPermission(user, 'agents:promotion-block')
  const canRankChange = hasPermission(user, 'rank-changes:manage')
  const canTerminate = hasPermission(user, 'terminations:manage')
  const canSanction = hasPermission(user, 'sanctions:manage')
  const canConfirmSanction = hasPermission(user, 'sanctions:confirm')
  const canManageNotes = hasPermission(user, 'notes:manage')
  const canManageContracts = hasPermission(user, 'contracts:manage')
  const canViewContracts = canManageContracts || hasPermission(user, 'contracts:view')
  const { data: agent, loading, refetch, setData: setAgent } = useFetch<AgentDetail>(canViewAgent ? `/api/agents/${id}` : null)
  const { data: ranks } = useFetch<Rank[]>(canEditAgent || canRankChange ? '/api/ranks' : null)
  const { data: units } = useFetch<Unit[]>(canManageAgentUnits ? '/api/units?active=true&forAssignment=true' : null)
  // Up- und D-Ranks laufen über dieselben Listen; auswählbar sind offene Listen,
  // deren Einreichungen noch nicht geschlossen wurden.
  const { data: rankChangeLists } = useFetch<RankChangeList[]>(canRankChange ? '/api/rank-change-lists' : null)
  const openRankChangeLists = rankChangeLists?.filter(l => l.status === 'DRAFT' && !l.submissionsClosed) ?? []

  const [editingMode, setEditingMode] = useState<'full' | 'units' | null>(null)
  const [deleteModal, setDeleteModal] = useState(false)
  const [terminateModal, setTerminateModal] = useState(false)
  const [sanctionModal, setSanctionModal] = useState(false)
  const [promoteModal, setPromoteModal] = useState(false)
  const [demoteModal, setDemoteModal] = useState(false)
  const [noteModal, setNoteModal] = useState(false)
  const [absenceModal, setAbsenceModal] = useState(false)
  const [terminateReason, setTerminateReason] = useState('')
  const [sanctionForm, setSanctionForm] = useState<SanctionForm>(EMPTY_SANCTION_FORM)
  const [editingSanction, setEditingSanction] = useState<SanctionRecord | null>(null)
  const [sanctionToDelete, setSanctionToDelete] = useState<SanctionRecord | null>(null)
  const [sanctionChecklist, setSanctionChecklist] = useState<Record<string, boolean>>({})
  const [repeatCheck, setRepeatCheck] = useState<RepeatAssessment | null>(null)
  const [newRankId, setNewRankId] = useState('')
  const [newBadgeNumber, setNewBadgeNumber] = useState('')
  const [rankChangeNote, setRankChangeNote] = useState('')
  const [noteForm, setNoteForm] = useState({ title: '', content: '' })
  const [contractBusy, setContractBusy] = useState(false)
  const [absenceEndsAt, setAbsenceEndsAt] = useState(dateAfterDays(3))
  const [absenceReason, setAbsenceReason] = useState('')
  const [form, setForm] = useState<AgentForm>(EMPTY_AGENT_FORM)
  const [addToListModal, setAddToListModal] = useState<'PROMOTION' | 'DEMOTION' | null>(null)
  const [addToListId, setAddToListId] = useState('')
  const [addToListRankId, setAddToListRankId] = useState('')
  const [addToListBadgeNumber, setAddToListBadgeNumber] = useState('')
  const [addToListNote, setAddToListNote] = useState('')
  const [playtimeHistoryExpanded, setPlaytimeHistoryExpanded] = useState(false)
  const [pendingTrainingOverride, setPendingTrainingOverride] = useState<{
    training: Training
    completed: boolean
  } | null>(null)
  const selectedGradeRule = isPenalGrade(sanctionForm.penalGrade)
    ? PENAL_GRADE_RULES[sanctionForm.penalGrade]
    : PENAL_GRADE_RULES['1']
  const selectedLevelRule = isSanctionLevel(sanctionForm.level)
    ? SANCTION_LEVELS[sanctionForm.level]
    : SANCTION_LEVELS['01']
  const selectedViolations = violationsForGrade(selectedGradeRule.grade)
  const sanctionChecklistComplete = DECISION_CHECKLIST.every((item) => sanctionChecklist[item.key])
  const editing = editingMode !== null
  const unitOnlyEditing = editingMode === 'units'

  const startEditing = (mode: 'full' | 'units' = 'full') => {
    if (!agent) return
    setForm({
      badgeNumber: agent.badgeNumber,
      firstName: agent.firstName,
      lastName: agent.lastName,
      rankId: agent.rankId,
      notes: agent.notes || '',
      status: agent.status,
      units: agentUnitKeys(agent),
      flag: agent.flag ?? '',
      hireDate: agent.hireDate?.split('T')[0] || '',
      discordId: agent.discordId ?? '',
    })
    setEditingMode(mode)
  }

  const handleSave = async () => {
    try {
      const payload = unitOnlyEditing
        ? { units: form.units }
        : {
            ...form,
            units: form.units,
            flag: form.flag ? form.flag : null,
            discordId: form.discordId.trim() === '' ? null : form.discordId.trim(),
          }
      await execute(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      addToast({ type: 'success', title: 'Agent aktualisiert' })
      setEditingMode(null)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleFlagChange = async (next: string | null) => {
    try {
      await execute(`/api/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ flag: next }),
      })
      addToast({ type: 'success', title: next ? `Markierung: ${getFlagLabel(next)}` : 'Markierung entfernt' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleTogglePromotionBlock = async () => {
    if (!agent) return
    const blocking = !agent.promotionBlocked
    try {
      await execute(`/api/agents/${id}/promotion-block`, { method: blocking ? 'POST' : 'DELETE' })
      addToast({ type: 'success', title: blocking ? 'Uprank-Sperre gesetzt' : 'Uprank-Sperre aufgehoben' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDelete = async () => {
    try {
      await execute(`/api/agents/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Agent gelöscht' })
      router.push('/agents')
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleTerminate = async () => {
    try {
      await execute('/api/terminations', {
        method: 'POST',
        body: JSON.stringify({ agentId: id, reason: terminateReason }),
      })
      addToast({ type: 'success', title: 'Agent gekündigt' })
      setTerminateModal(false)
      setTerminateReason('')
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  /**
   * Wiederholungsprüfung nach Abschnitt 04 — sobald Grade und Verstoß feststehen,
   * holt die Seite die gleichartigen Vorverstöße und den Stufenvorschlag.
   */
  useEffect(() => {
    if (!sanctionModal || !canSanction || !sanctionForm.violationCode) {
      setRepeatCheck(null)
      return
    }

    let cancelled = false
    const params = new URLSearchParams({
      agentId: id,
      penalGrade: sanctionForm.penalGrade,
      violationCode: sanctionForm.violationCode,
    })
    if (editingSanction) params.set('excludeSanctionId', editingSanction.id)

    fetch(`/api/sanctions/repeat-check?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setRepeatCheck(json.data as RepeatAssessment)
      })
      .catch(() => {
        if (!cancelled) setRepeatCheck(null)
      })

    return () => { cancelled = true }
  }, [sanctionModal, canSanction, id, sanctionForm.penalGrade, sanctionForm.violationCode, editingSanction])

  const openSanctionModal = () => {
    setSanctionForm(EMPTY_SANCTION_FORM)
    setEditingSanction(null)
    setSanctionChecklist({})
    setRepeatCheck(null)
    setSanctionModal(true)
  }

  const openEditSanctionModal = (sanction: SanctionRecord) => {
    setEditingSanction(sanction)
    setSanctionForm({
      penalGrade: isPenalGrade(sanction.penalGrade) ? sanction.penalGrade : '1',
      level: isSanctionLevel(sanction.level) ? sanction.level : '01',
      violationCode: sanction.violationCode ?? '',
      reason: sanction.reason,
      penalty: sanction.penalty ?? '',
      suspensionHours: '',
      mitigating: [],
      aggravating: [],
    })
    // Der Entscheidungs-Check wird bei jeder Änderung neu bestätigt.
    setSanctionChecklist({})
    setRepeatCheck(null)
    setSanctionModal(true)
  }

  const closeSanctionModal = () => {
    setSanctionModal(false)
    setEditingSanction(null)
    setSanctionForm(EMPTY_SANCTION_FORM)
    setSanctionChecklist({})
    setRepeatCheck(null)
  }

  /**
   * Grade-Wechsel setzt Stufe auf die Regelsanktion und verwirft den Verstoß,
   * da Verstöße immer genau zu einem Grade gehören.
   */
  const handleSanctionGradeChange = (penalGrade: string) => {
    const rule = isPenalGrade(penalGrade) ? PENAL_GRADE_RULES[penalGrade] : null
    setSanctionForm((current) => ({
      ...current,
      penalGrade,
      level: rule ? rule.regularLevels[0] : current.level,
      violationCode: '',
    }))
    setRepeatCheck(null)
  }

  const toggleCircumstance = (kind: 'mitigating' | 'aggravating', value: string) => {
    setSanctionForm((current) => {
      const list = current[kind]
      return {
        ...current,
        [kind]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      }
    })
  }

  /** Erstellt einen Arbeitsvertrag aus der Standardvorlage und versendet ihn. */
  const handleCreateContract = async () => {
    setContractBusy(true)
    try {
      await execute('/api/contracts', {
        method: 'POST',
        body: JSON.stringify({ agentId: id, applicationId: agent?.jobApplication?.id ?? null }),
      })
      addToast({ type: 'success', title: 'Vertrag erstellt und versendet' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    } finally {
      setContractBusy(false)
    }
  }

  /** „Vertragsnachricht senden“ — schickt den persönlichen Link erneut per DM. */
  const handleSendContractMessage = async (contractId: string) => {
    setContractBusy(true)
    try {
      await execute(`/api/contracts/${contractId}/send`, { method: 'POST' })
      addToast({ type: 'success', title: 'Vertragsnachricht gesendet' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Versand fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setContractBusy(false)
    }
  }

  const handleCopyContractLink = async (token: string) => {
    const url = `${window.location.origin}/vertrag/${token}`
    try {
      await navigator.clipboard.writeText(url)
      addToast({ type: 'success', title: 'Vertragslink kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Kopieren fehlgeschlagen', message: url })
    }
  }

  const handleSanction = async () => {
    if (!sanctionForm.reason.trim() || !sanctionChecklistComplete) return
    try {
      const isEditingSanction = !!editingSanction
      await execute(isEditingSanction ? `/api/sanctions/${editingSanction.id}` : '/api/sanctions', {
        method: isEditingSanction ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(isEditingSanction ? {} : { agentId: id }),
          penalGrade: sanctionForm.penalGrade,
          level: sanctionForm.level,
          violationCode: sanctionForm.violationCode || null,
          reason: sanctionForm.reason.trim(),
          penalty: sanctionForm.penalty.trim(),
          checklist: sanctionChecklist,
          mitigating: sanctionForm.mitigating,
          aggravating: sanctionForm.aggravating,
          ...(selectedLevelRule.suspends ? { suspensionHours: sanctionForm.suspensionHours.trim() || null } : {}),
        }),
      })
      addToast({ type: 'success', title: isEditingSanction ? 'Sanktion aktualisiert' : 'Sanktion ausgestellt' })
      closeSanctionModal()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const patchSanction = async (sanctionId: string, action: string, successTitle: string) => {
    try {
      await execute(`/api/sanctions/${sanctionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      addToast({ type: 'success', title: successTitle })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleExecuteSanction = (sanctionId: string) =>
    patchSanction(sanctionId, 'EXECUTE', 'Maßnahme als vollzogen vermerkt')

  const handleConfirmSanction = (sanctionId: string) =>
    patchSanction(sanctionId, 'CONFIRM', 'Sanktion bestätigt')

  const handleRevokeSanction = (sanctionId: string) =>
    patchSanction(sanctionId, 'REVOKE', 'Sanktion aufgehoben')

  const handleDeleteSanction = async (sanctionId: string) => {
    try {
      await execute(`/api/sanctions/${sanctionId}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Sanktion gelöscht' })
      setSanctionToDelete(null)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleReactivate = async () => {
    try {
      await execute(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) })
      addToast({ type: 'success', title: 'Agent reaktiviert' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleRankChange = async (direction: 'up' | 'down') => {
    if (!newRankId) return
    try {
      await execute('/api/promotions', {
        method: 'POST',
        body: JSON.stringify({
          agentId: id,
          newRankId,
          newBadgeNumber: newBadgeNumber || undefined,
          note: rankChangeNote || undefined,
        }),
      })
      addToast({ type: 'success', title: direction === 'up' ? 'Beförderung durchgeführt' : 'Degradierung durchgeführt' })
      setPromoteModal(false)
      setDemoteModal(false)
      setNewRankId('')
      setNewBadgeNumber('')
      setRankChangeNote('')
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleAddNote = async () => {
    if (!noteForm.content.trim()) return
    try {
      await execute('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ ...noteForm, agentId: id }),
      })
      addToast({ type: 'success', title: 'Notiz hinzugefügt' })
      setNoteModal(false)
      setNoteForm({ title: '', content: '' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    try {
      await execute(`/api/notes/${noteId}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Notiz gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const openAbsenceModal = () => {
    setAbsenceEndsAt(dateAfterDays(3))
    setAbsenceReason('')
    setAbsenceModal(true)
  }

  const handleAddAbsence = async () => {
    if (!absenceReason.trim() || !absenceEndsAt) return
    try {
      await execute('/api/absences', {
        method: 'POST',
        body: JSON.stringify({
          agentId: id,
          endsAt: absenceEndsAt,
          reason: absenceReason.trim(),
        }),
      })
      addToast({ type: 'success', title: 'Abmeldung eingetragen' })
      setAbsenceModal(false)
      setAbsenceReason('')
      notifyLiveUpdate()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const openAddToListModal = (type: 'PROMOTION' | 'DEMOTION') => {
    setAddToListModal(type)
    setAddToListId('')
    setAddToListRankId('')
    setAddToListBadgeNumber('')
    setAddToListNote('')
  }

  const handleAddToList = async () => {
    if (!addToListModal || !addToListId || !addToListRankId) return
    try {
      await execute(`/api/rank-change-lists/${addToListId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          agentId: id,
          proposedRankId: addToListRankId,
          newBadgeNumber: addToListBadgeNumber || undefined,
          note: addToListNote || undefined,
        }),
      })
      const label = addToListModal === 'PROMOTION' ? 'Up-Rank-Liste' : 'D-Rank-Liste'
      addToast({ type: 'success', title: `Zur ${label} hinzugefügt` })
      setAddToListModal(null)
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleTrainingToggle = useCallback(async (trainingId: string, completed: boolean, overrideConfirmed = false) => {
    if (!canEditTrainings) return
    if (!agent) return
    const trainingRow = agent.trainings.find((t) => t.trainingId === trainingId)
    if (!trainingRow) return
    const requiresOverride = completed && !trainingAvailableForAgent(trainingRow.training, agent)
    if (requiresOverride && !overrideConfirmed) {
      setPendingTrainingOverride({ training: trainingRow.training, completed })
      return
    }
    const previous = agent
    const trainings = agent.trainings.map((t) => ({
      trainingId: t.trainingId,
      completed: t.trainingId === trainingId ? completed : t.completed,
    }))
    setAgent((o) => o ? ({
      ...o,
      trainings: o.trainings.map((t) =>
        t.trainingId === trainingId ? { ...t, completed } : t
      ),
    }) : o)
    try {
      const res = await fetch(`/api/agents/${id}/trainings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainings,
          overrideTrainingIds: requiresOverride && overrideConfirmed ? [trainingId] : [],
        }),
      })
      const json = await res.json() as { data?: { agent?: AgentDetail }; error?: string }
      if (!res.ok) throw new Error(json.error || 'Fehler')
      if (json.data?.agent) setAgent(json.data.agent)
      notifyLiveUpdate()
    } catch (err) {
      setAgent(previous)
      addToast({
        type: 'error',
        title: 'Fehler beim Aktualisieren',
        message: err instanceof Error ? err.message : '',
      })
    }
  }, [canEditTrainings, agent, id, setAgent, setPendingTrainingOverride, addToast])

  if (!canViewAgent) return <UnauthorizedContent />
  if (loading) return <PageLoader />
  if (!agent) return <div className="text-center py-16 text-[#999]">Agent nicht gefunden</div>

  const higherRanks = ranks?.filter(r => r.sortOrder < agent.rank?.sortOrder) || []
  const lowerRanks = ranks?.filter(r => r.sortOrder > agent.rank?.sortOrder) || []
  const addToListRanks = addToListModal === 'PROMOTION' ? higherRanks : lowerRanks
  // Laufend = ausgesprochen oder vollzogen, also noch nicht abschließend entschieden.
  const openSanctions = agent.sanctions?.filter(
    (sanction) => sanction.status === 'ISSUED' || sanction.status === 'EXECUTED',
  ) ?? []
  const playtimeSessions = agent.playtime?.recentSessions ?? []
  const canTogglePlaytimeHistory = playtimeSessions.length > PLAYTIME_HISTORY_COLLAPSE_LIMIT
  const visiblePlaytimeSessions = playtimeHistoryExpanded
    ? playtimeSessions
    : playtimeSessions.slice(0, PLAYTIME_HISTORY_COLLAPSE_LIMIT)

  return (
    <div>
      <PageHeader
        title={`${agent.firstName} ${agent.lastName}`}
        description={`DN: ${displayBadgeNumber(agent.badgeNumber)} · ${agent.rank?.name}${agent.rank?.internalNumber != null ? ` · Rang ${agent.rank.internalNumber}` : ''}`}
        action={
          <div className="flex gap-1.5 flex-wrap">
            <AgentAvatar agent={agent} size="sm" ringColor={agent.rank?.color} className="mr-1" />
            <Link href="/agents">
              <Button variant="ghost" size="sm"><ArrowLeft size={15} strokeWidth={1.75} /> Zurück</Button>
            </Link>
            <Link href={`/agents/${id}/timeline`}>
              <Button variant="secondary" size="sm"><History size={14} strokeWidth={1.75} /> Akte</Button>
            </Link>
            <a href={`/api/exports?type=agent&format=html&agentId=${id}`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm"><Download size={14} strokeWidth={1.75} /> Export</Button>
            </a>
            {!editing ? (
              <>
                {canEditAgent && (
                  <Button variant="secondary" size="sm" onClick={() => startEditing('full')}><Edit size={14} strokeWidth={1.75} /> Bearbeiten</Button>
                )}
                {!canEditAgent && canManageAgentUnits && (
                  <Button variant="secondary" size="sm" onClick={() => startEditing('units')}><Edit size={14} strokeWidth={1.75} /> Units</Button>
                )}
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setEditingMode(null)}><X size={14} /> Abbrechen</Button>
                <Button size="sm" onClick={handleSave}><Save size={14} strokeWidth={1.75} /> Speichern</Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column: main info */}
        <div className="lg:col-span-2 space-y-4">
          {hasPermission(user, 'codenames:view') && <div className="glass-panel-elevated rounded-[14px] p-5"><CodenameHistory agentId={id} /></div>}
          {/* Personal data */}
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4">Persönliche Daten</h3>
            {editing ? (
              <div className="space-y-4">
                {unitOnlyEditing ? (
                  <UnitMultiSelect value={form.units} units={units ?? undefined} onChange={(value) => setForm({ ...form, units: value })} />
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input label="Vorname" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                      <Input label="Nachname" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input label="Dienstnummer" numericOnly value={form.badgeNumber} onChange={(e) => setForm({ ...form, badgeNumber: e.target.value })} />
                      <Select label="Rang" value={form.rankId} onChange={(e) => setForm({ ...form, rankId: e.target.value })} options={ranks?.map(r => ({ value: r.id, label: r.name })) || []} />
                    </div>
                    <Input
                      label="Discord-ID"
                      value={form.discordId}
                      onChange={(e) => setForm({ ...form, discordId: e.target.value })}
                      placeholder="Optional (Snowflake)"
                      className="font-mono"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[
                        { value: 'ACTIVE', label: 'Aktiv' },
                        { value: 'AWAY', label: 'Abgemeldet' },
                        { value: 'INACTIVE', label: 'Inaktiv' },
                        { value: 'TERMINATED', label: 'Gekündigt' },
                      ]} />
                      <DateField
                        label="Einstellungsdatum"
                        value={form.hireDate}
                        onChange={(v) => setForm({ ...form, hireDate: v })}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {canManageAgentUnits ? (
                        <UnitMultiSelect value={form.units} units={units ?? undefined} onChange={(value) => setForm({ ...form, units: value })} />
                      ) : (
                        <div>
                          <p className="mb-2 block text-[12.5px] font-medium text-[#aeaeae]">Units</p>
                          <div className="rounded-[10px] border border-[#343434]/50 bg-[#181818]/30 px-3 py-2.5">
                            <UnitBadges agent={agent} units={units ?? undefined} emptyClassName="text-[12px]" />
                            <p className="mt-1.5 text-[10px] text-[#6e6e6e]">Nur markierte Unit-Leitungen oder Administratoren dürfen Units ändern.</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-1.5">Markierung</label>
                      <FlagPicker value={form.flag ?? null} onChange={(v) => setForm({ ...form, flag: v ?? '' })} />
                    </div>
                    <Textarea label="Notizen" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-5 gap-x-6">
                <InfoRow label="Dienstnummer" value={displayBadgeNumber(agent.badgeNumber)} mono />
                <InfoRow label="Discord-ID" value={agent.discordId ?? undefined} mono />
                <InfoRow label="Discord-Server">
                  <DiscordMemberStatus agent={agent} />
                </InfoRow>
                <InfoRow label="Rang">
                  <span className="inline-flex items-center gap-2">
                     <span className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.rank?.color }} />
                     <span className="text-[13.5px] text-[#eee]">{agent.rank?.name}</span>
                     <RankNumberBadge number={agent.rank?.internalNumber} />
                   </span>
                </InfoRow>
                <InfoRow label="Status">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-[6px] w-[6px] rounded-full', getStatusDot(agent.status))} />
                    <span className="text-[13.5px] text-[#eee]">{getStatusLabel(agent.status)}</span>
                  </span>
                </InfoRow>
                <InfoRow label="Einstellungsdatum" value={formatDate(agent.hireDate)} />
                <InfoRow label="Eingestellt von" value={agent.hiredBy?.displayName ?? undefined} />
                <InfoRow label="Units">
                  <UnitBadges agent={agent} units={units ?? undefined} emptyClassName="text-[13.5px]" />
                </InfoRow>
                <InfoRow label="Markierung">
                  {agent.flag ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-[10px] w-[10px] rounded-full"
                        style={{ backgroundColor: getFlagColor(agent.flag) }}
                      />
                      <span className="text-[13.5px] text-[#eee]">{getFlagLabel(agent.flag)}</span>
                    </span>
                  ) : (
                    <span className="text-[13.5px] text-[#808080]">—</span>
                  )}
                </InfoRow>
                <InfoRow label="Uprank-Sperre">
                  {agent.promotionBlocked ? (
                    <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[#f59e0b]">
                      <CircleSlash size={14} strokeWidth={2} /> Aktiv – Beförderungen blockiert
                    </span>
                  ) : (
                    <span className="text-[13.5px] text-[#808080]">—</span>
                  )}
                </InfoRow>
                <InfoRow label="Zuletzt Online" value={formatDateTime(agent.lastOnline)} />
                {agent.notes && (
                  <div className="col-span-full">
                    <InfoRow label="Notizen" value={agent.notes} />
                  </div>
                )}
              </div>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.03 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-[13.5px] font-semibold text-[#eee]">Dienstzeiten</h3>
              <Link href="/duty-times" className="text-[12px] text-[#d4d4d4] hover:text-white transition-colors">Übersicht</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <DutyMetric
                label="Status"
                value={agent.dutyTime?.activeSession ? 'Im Dienst' : 'Offline'}
                active={!!agent.dutyTime?.activeSession}
              />
              <DutyMetric
                label="Aktive Spielzeit"
                value={formatDuration(agent.dutyTime?.activeSession?.currentDurationMs ?? 0)}
                active={!!agent.dutyTime?.activeSession}
              />
              <DutyMetric
                label="Diese Woche"
                value={formatDuration(agent.dutyTime?.weekDurationMs ?? 0)}
              />
              <DutyMetric
                label="Gesamt-Dienstzeit"
                value={formatDuration(agent.dutyTime?.totalDurationMs ?? 0)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
              <DutyMetric
                label="Sessions"
                value={String(agent.dutyTime?.sessionCount ?? 0)}
              />
              <DutyMetric
                label="Ø Session"
                value={formatDuration(agent.dutyTime?.averageSessionMs ?? 0)}
              />
              <DutyMetric
                label="Längste Session"
                value={formatDuration(agent.dutyTime?.longestSessionMs ?? 0)}
              />
              <DutyMetric
                label="Zuletzt gesehen"
                value={formatDateTime(agent.dutyTime?.lastSeenAt)}
                active={!!agent.dutyTime?.activePlaySession}
              />
            </div>
            {agent.dutyTime?.activeSession && (
              <p className="mt-3 text-[11.5px] text-[#868686]">
                Im Dienst seit {formatDateTime(agent.dutyTime.activeSession.clockInAt)}
              </p>
            )}
            {agent.dutyTime?.activePlaySession && (
              <p className="mt-1 text-[11.5px] text-[#868686]">
                Spieler {agent.dutyTime.activePlaySession.playerName}
                {agent.dutyTime.activePlaySession.license ? ` · ${agent.dutyTime.activePlaySession.license}` : ''}
              </p>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.04 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4">Spielzeit</h3>
            <PlaytimeChart daily={agent.playtime?.daily ?? []} />
            <div className="silver-line my-4" />
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-[12.5px] font-semibold text-[#d2d2d2]">Verlauf</h4>
              {canTogglePlaytimeHistory && (
                <button
                  type="button"
                  onClick={() => setPlaytimeHistoryExpanded((expanded) => !expanded)}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-medium text-[#d4d4d4] transition-colors hover:bg-[#212121] hover:text-white"
                >
                  {playtimeHistoryExpanded ? (
                    <>
                      <ChevronUp size={13} strokeWidth={1.9} />
                      Weniger anzeigen
                    </>
                  ) : (
                    <>
                      <ChevronDown size={13} strokeWidth={1.9} />
                      Alle anzeigen ({playtimeSessions.length})
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {playtimeSessions.length > 0 ? (
                visiblePlaytimeSessions.map((session) => (
                  <div key={session.id} className="flex flex-col gap-1 rounded-[8px] bg-[#212121]/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-[#f4f4f4] truncate">{session.playerName}</p>
                      <p className="text-[11px] text-[#868686] truncate">{formatDateTime(session.startedAt)} → {session.endedAt ? formatDateTime(session.endedAt) : 'online'}</p>
                    </div>
                    <span className="text-[12.5px] font-semibold tabular-nums text-[#d4d4d4]">{formatDuration(session.durationMs)}</span>
                  </div>
                ))
              ) : (
                <p className="text-[12.5px] text-[#808080]">Noch keine Spielzeit empfangen</p>
              )}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="text-[13.5px] font-semibold text-[#eee]">Abmeldungen</h3>
              {canEditAgent && agent.status !== 'TERMINATED' && (
                <button
                  type="button"
                  onClick={openAbsenceModal}
                  className="inline-flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[11.5px] text-[#d4d4d4] transition-colors hover:bg-[#212121]"
                >
                  <CalendarPlus size={12} strokeWidth={1.85} />
                  Eintragen
                </button>
              )}
            </div>
            {agent.absences?.active && (
              <div className="mb-3 rounded-[10px] border border-[#38bdf8]/25 bg-[#1e1e1e]/70 px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-[#93c5fd]">Aktiv abgemeldet</p>
                  <span className="text-[11.5px] tabular-nums text-[#d4d4d4]">
                    bis {formatDateTime(agent.absences.active.endsAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-[#d2d2d2]">{agent.absences.active.reason}</p>
              </div>
            )}
            {(agent.absences?.recent ?? []).length > 0 ? (
              <div className="space-y-2">
                {agent.absences!.recent.map((notice) => (
                  <div key={notice.id} className="rounded-[8px] bg-[#212121]/70 px-3 py-2.5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[12.5px] font-medium text-[#f4f4f4]">
                        {formatDateTime(notice.startsAt)} → {formatDateTime(notice.endsAt)}
                      </p>
                      <span className="text-[11px] text-[#38bdf8]">{notice.source}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-[#a6a6a6]">{notice.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#808080]">Keine Abmeldungen vorhanden</p>
            )}
          </motion.div>

          {/* Trainings -- toggleable directly */}
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4">Ausbildungen</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {agent.trainings?.map((t) => (
                <button
                  key={t.id}
                  disabled={!canEditTrainings}
                  onClick={() => canEditTrainings && handleTrainingToggle(t.trainingId, !t.completed)}
                  title={!trainingAvailableForAgent(t.training, agent) ? `${t.training.label} ist erst ab ${t.training.minRank?.name ?? 'Mindestrang'} vorgesehen` : t.training.label}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] transition-all duration-150 text-left',
                    t.completed
                      ? 'bg-[#212121] hover:bg-[#2a2a2a]'
                      : trainingAvailableForAgent(t.training, agent)
                        ? 'hover:bg-[#212121]'
                        : 'border border-dashed border-[#808080]/45 bg-[#080808]/70 hover:bg-[#212121]',
                    !canEditTrainings && 'cursor-not-allowed opacity-75'
                  )}
                >
                  <div className={cn(
                    'h-[18px] w-[18px] rounded-[4px] flex items-center justify-center shrink-0 transition-colors',
                    t.completed ? 'bg-[#d4d4d4]' : 'bg-[#343434]'
                  )}>
                    {t.completed && <Check size={11} className="text-[#1d1d1d]" strokeWidth={3} />}
                  </div>
                  <span className={cn(
                    'text-[13px]',
                    t.completed ? 'text-[#eee]' : trainingAvailableForAgent(t.training, agent) ? 'text-[#808080]' : 'text-[#555555]'
                  )}>{t.training.label}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Promotion history */}
          {agent.promotionLogs?.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
              className="glass-panel-elevated rounded-[14px] p-5">
              <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4">Ranghistorie</h3>
              <div className="space-y-3">
                {agent.promotionLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className={cn(
                      'h-7 w-7 rounded-[6px] flex items-center justify-center shrink-0 mt-0.5',
                      log.oldRank.sortOrder > log.newRank.sortOrder
                        ? 'bg-[#212121]'
                        : 'bg-[#212121]'
                    )}>
                      {log.oldRank.sortOrder > log.newRank.sortOrder
                        ? <TrendingUp size={13} className="text-[#999]" strokeWidth={1.75} />
                        : <TrendingDown size={13} className="text-[#999]" strokeWidth={1.75} />
                      }
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-[#eee]">
                        {log.oldRank.name} → {log.newRank.name}
                      </p>
                      <p className="text-[11.5px] text-[#999] mt-0.5">{formatDate(log.createdAt)} · {log.performedBy?.displayName ?? 'Gelöscht'}</p>
                      {log.note && <p className="text-[11.5px] text-[#666] mt-0.5">{log.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {canViewContracts && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.105 }}
              className="glass-panel-elevated rounded-[14px] p-5">
              <ContractSection
                contracts={agent.contracts ?? []}
                application={agent.jobApplication ?? null}
                agentHasDiscordId={Boolean(agent.discordId)}
                canManage={canManageContracts}
                busy={contractBusy}
                onCreate={handleCreateContract}
                onSend={handleSendContractMessage}
                onCopyLink={handleCopyContractLink}
              />
            </motion.div>
          )}

          {openSanctions.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.11 }}
              className="glass-panel-elevated rounded-[14px] p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-[13.5px] font-semibold text-[#eee]">Laufende Sanktionen</h3>
                <span className="rounded-full border border-[#b45309]/40 bg-[#1d1608]/70 px-2.5 py-1 text-[11px] font-medium text-[#fbbf24]">
                  {openSanctions.length} laufend
                </span>
              </div>
              <div className="space-y-2.5">
                {openSanctions.map((sanction) => (
                  <SanctionCard key={sanction.id} sanction={sanction} canSanction={canSanction}
                    canConfirm={canConfirmSanction}
                    onExecute={sanction.status === 'ISSUED' ? () => handleExecuteSanction(sanction.id) : undefined}
                    onConfirm={() => handleConfirmSanction(sanction.id)}
                    onEdit={() => openEditSanctionModal(sanction)}
                    onRevoke={() => handleRevokeSanction(sanction.id)}
                    onDelete={() => setSanctionToDelete(sanction)}
                    variant="open"
                  />
                ))}
              </div>
            </motion.div>
          )}

          {agent.sanctions?.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.12 }}
              className="glass-panel-elevated rounded-[14px] p-5">
              <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4">Sanktionshistorie</h3>
              <div className="space-y-2.5">
                {agent.sanctions.map((sanction) => (
                  <SanctionCard key={sanction.id} sanction={sanction} canSanction={canSanction}
                    onEdit={() => openEditSanctionModal(sanction)}
                    onDelete={() => setSanctionToDelete(sanction)}
                    variant="history"
                  />
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Right column: actions + notes */}
        <div className="space-y-4">
          {/* Quick actions */}
          {!editing && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
              className="glass-panel-elevated rounded-[14px] p-5">
              <h3 className="text-[13.5px] font-semibold text-[#eee] mb-3">Markierung</h3>
              <div className="mb-4">
                {canEditAgent ? (
                  <FlagPicker value={agent.flag ?? null} onChange={handleFlagChange} />
                ) : (
                  <p className="text-[12.5px] text-[#808080]">Keine Bearbeitungsrechte</p>
                )}
              </div>
              <div className="silver-line my-3" />
              <h3 className="text-[13.5px] font-semibold text-[#eee] mb-3">Aktionen</h3>
              <div className="space-y-1.5">
                {canRankChange && agent.status !== 'TERMINATED' && higherRanks.length > 0 && (
                  <button onClick={() => { setNewRankId(''); setNewBadgeNumber(''); setRankChangeNote(''); setPromoteModal(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#999] hover:bg-[#212121] transition-colors text-left">
                    <TrendingUp size={15} strokeWidth={1.75} /> Befördern
                  </button>
                )}
                {canRankChange && agent.status !== 'TERMINATED' && openRankChangeLists.length > 0 && (
                  <button onClick={() => openAddToListModal('PROMOTION')}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#999] hover:bg-[#212121] transition-colors text-left">
                    <ListPlus size={15} strokeWidth={1.75} /> Zur Up-Rank-Liste
                  </button>
                )}
                {canRankChange && agent.status !== 'TERMINATED' && lowerRanks.length > 0 && (
                  <button onClick={() => { setNewRankId(''); setNewBadgeNumber(''); setRankChangeNote(''); setDemoteModal(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#999] hover:bg-[#212121] transition-colors text-left">
                    <TrendingDown size={15} strokeWidth={1.75} /> Degradieren
                  </button>
                )}
                {canRankChange && agent.status !== 'TERMINATED' && openRankChangeLists.length > 0 && (
                  <button onClick={() => openAddToListModal('DEMOTION')}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#999] hover:bg-[#212121] transition-colors text-left">
                    <ListPlus size={15} strokeWidth={1.75} /> Zur D-Rank-Liste
                  </button>
                )}
                {canManageNotes && (
                  <button onClick={() => { setNoteForm({ title: '', content: '' }); setNoteModal(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#999] hover:bg-[#212121] transition-colors text-left">
                    <StickyNote size={15} strokeWidth={1.75} /> Notiz hinzufügen
                  </button>
                )}
                {canSanction && agent.status !== 'TERMINATED' && (
                  <button onClick={openSanctionModal}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#f59e0b] hover:bg-[#1d1608] transition-colors text-left">
                    <Gavel size={15} strokeWidth={1.75} /> Sanktion
                  </button>
                )}
                {canBlockPromotion && agent.status !== 'TERMINATED' && (
                  <button onClick={handleTogglePromotionBlock}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] transition-colors text-left',
                      agent.promotionBlocked
                        ? 'text-[#34d399] hover:bg-[#212121]'
                        : 'text-[#f59e0b] hover:bg-[#1d1608]',
                    )}>
                    <CircleSlash size={15} strokeWidth={1.75} />
                    {agent.promotionBlocked ? 'Uprank-Sperre aufheben' : 'Uprank-Sperre setzen'}
                  </button>
                )}
                {canEditAgent && agent.status === 'TERMINATED' ? (
                  <button onClick={handleReactivate}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#34d399] hover:bg-[#212121] transition-colors text-left">
                    <UserCheck size={15} strokeWidth={1.75} /> Reaktivieren
                  </button>
                ) : canTerminate ? (
                  <button onClick={() => { setTerminateReason(''); setTerminateModal(true) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#f87171] hover:bg-[#1c1111] transition-colors text-left">
                    <UserX size={15} strokeWidth={1.75} /> Kündigen
                  </button>
                ) : null}
                {canDeleteAgent && (
                  <button onClick={() => setDeleteModal(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[8px] text-[13px] text-[#f87171] hover:bg-[#1c1111] transition-colors text-left">
                    <Trash2 size={15} strokeWidth={1.75} /> Löschen
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* Notes */}
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}
            className="glass-panel-elevated rounded-[14px] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13.5px] font-semibold text-[#eee]">Notizen</h3>
              {canManageNotes && (
                <button onClick={() => { setNoteForm({ title: '', content: '' }); setNoteModal(true) }}
                  className="p-1 rounded-[6px] hover:bg-[#212121] transition-colors">
                  <Plus size={14} className="text-[#808080]" />
                </button>
              )}
            </div>
            {agent.agentNotes?.length > 0 ? (
              <div className="space-y-2.5">
                {agent.agentNotes.map((note) => (
                  <div key={note.id} className="bg-[#212121] rounded-[8px] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {note.title && <p className="text-[13px] font-medium text-[#eee] mb-1">{note.title}</p>}
                        <p className="text-[13px] text-[#999] leading-relaxed">{note.content}</p>
                      </div>
                      {canManageNotes && (
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note.id)}
                          className="shrink-0 rounded-[6px] p-1 text-[#808080] transition-colors hover:bg-[#1c1111] hover:text-[#f87171]"
                          aria-label="Notiz löschen"
                          title="Notiz löschen"
                        >
                          <Trash2 size={13} strokeWidth={1.85} />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-[#808080] mt-2">{formatDate(note.createdAt)} · {note.author?.displayName ?? 'Gelöscht'}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-[#808080]">Keine Notizen vorhanden</p>
            )}
          </motion.div>

        </div>
      </div>

      {/* Delete modal */}
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Agent löschen">
        <p className="text-[13px] text-[#888] mb-5">
          Soll <strong className="text-[#eee]">{agent.firstName} {agent.lastName}</strong> unwiderruflich gelöscht werden?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteModal(false)}>Abbrechen</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Endgültig löschen</Button>
        </div>
      </Modal>

      {/* Terminate modal */}
      <Modal open={terminateModal} onClose={() => setTerminateModal(false)} title="Agent kündigen">
        <div className="space-y-4">
          <p className="text-[13px] text-[#888]">
            <strong className="text-[#eee]">{agent.firstName} {agent.lastName}</strong> wird gekündigt.
          </p>
          <Textarea label="Kündigungsgrund" value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} rows={3} required placeholder="Grund..." />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTerminateModal(false)}>Abbrechen</Button>
            <Button variant="danger" size="sm" onClick={handleTerminate} disabled={!terminateReason.trim()}>Kündigung bestätigen</Button>
          </div>
        </div>
      </Modal>

      <Modal open={sanctionModal} onClose={closeSanctionModal} title={editingSanction ? 'Sanktion bearbeiten' : 'Sanktion ausstellen'}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-[10px] border border-[#343434]/60 bg-[#1c1c1c]/70 px-3.5 py-3">
            <Gavel size={15} className="text-[#f59e0b] shrink-0" strokeWidth={1.75} />
            <p className="text-[13px] text-[#aeaeae]">
              {editingSanction ? 'Sanktion bearbeiten für' : 'Neue Sanktion für'}{' '}
              <strong className="text-[#eee] font-semibold">{agent.firstName} {agent.lastName}</strong>
            </p>
          </div>

          <Select
            label="Penal Grade"
            value={sanctionForm.penalGrade}
            onValueChange={handleSanctionGradeChange}
            options={PENAL_GRADE_OPTIONS}
          />

          <div className="rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-[#aeaeae]">{selectedGradeRule.severity}</p>
            <p className="mt-1 text-[13px] leading-snug text-[#f4f4f4]">{selectedGradeRule.description}</p>
            <p className="mt-1.5 text-[12px] text-[#808080]">
              Typische Folge: {selectedGradeRule.typicalConsequence}
            </p>
          </div>

          <Select
            label="Verstoß"
            value={sanctionForm.violationCode}
            onValueChange={(violationCode) => setSanctionForm({ ...sanctionForm, violationCode })}
            options={[
              { value: '', label: 'Kein Katalog-Verstoß' },
              ...selectedViolations.map((item) => ({ value: item.code, label: item.label })),
            ]}
          />

          {repeatCheck && repeatCheck.occurrence > 1 && (
            <div className="rounded-[10px] border border-[#b45309]/40 bg-[#1d1608]/60 px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-[#fbbf24]">
                Wiederholungsfall — {repeatCheck.occurrence}. gleichartiger Verstoß
              </p>
              <p className="mt-1 text-[12.5px] leading-snug text-[#d4d4d4]">{repeatCheck.principle}</p>
              <p className="mt-1.5 text-[12px] text-[#a6a6a6]">
                Empfohlene Stufe: {repeatCheck.recommendedLevelLabel}
              </p>
              {repeatCheck.recommendedLevel !== sanctionForm.level && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2.5"
                  onClick={() => setSanctionForm({ ...sanctionForm, level: repeatCheck.recommendedLevel })}
                >
                  Empfehlung übernehmen
                </Button>
              )}
              {repeatCheck.priors.length > 0 && (
                <ul className="mt-2.5 space-y-1 border-t border-[#b45309]/25 pt-2.5">
                  {repeatCheck.priors.slice(0, 4).map((prior) => (
                    <li key={prior.id} className="text-[11.5px] leading-snug text-[#a6a6a6]">
                      {new Date(prior.createdAt).toLocaleDateString('de-DE')} ·{' '}
                      {sanctionLevelLabel(prior.level)} — {prior.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Select
            label="Sanktionsstufe"
            value={sanctionForm.level}
            onValueChange={(level) => setSanctionForm({ ...sanctionForm, level })}
            options={SANCTION_LEVEL_OPTIONS}
          />

          <div className="rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-[#aeaeae]">Anwendung</p>
            <p className="mt-1 text-[13px] leading-snug text-[#f4f4f4]">{selectedLevelRule.application}</p>
          </div>

          {selectedLevelRule.suspends && !editingSanction && (
            <Input
              label="Suspendierung in Stunden"
              value={sanctionForm.suspensionHours}
              onChange={(e) => setSanctionForm({ ...sanctionForm, suspensionHours: e.target.value })}
              inputMode="numeric"
              placeholder="z.B. 48"
            />
          )}

          <Textarea
            label="Grund *"
            value={sanctionForm.reason}
            onChange={(e) => setSanctionForm({ ...sanctionForm, reason: e.target.value })}
            rows={4}
            required
            placeholder="Detaillierter Grund der Sanktion..."
          />

          <Textarea
            label="Weitere Folge"
            value={sanctionForm.penalty}
            onChange={(e) => setSanctionForm({ ...sanctionForm, penalty: e.target.value })}
            rows={2}
            placeholder="Zusätzliche Auflagen oder Folgen (optional)..."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] border border-[#166534]/40 bg-[#052e1a]/30 px-3 py-2.5">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#86efac]">Mildernd</p>
              <div className="space-y-1.5">
                {MITIGATING_CIRCUMSTANCES.map((item) => (
                  <label key={item} className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={sanctionForm.mitigating.includes(item)}
                      onChange={() => toggleCircumstance('mitigating', item)}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#16a34a]"
                    />
                    <span className="text-[12px] leading-snug text-[#c3c3c3]">{item}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-[10px] border border-[#7f1d1d]/40 bg-[#2a1212]/30 px-3 py-2.5">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#fca5a5]">Erschwerend</p>
              <div className="space-y-1.5">
                {AGGRAVATING_CIRCUMSTANCES.map((item) => (
                  <label key={item} className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={sanctionForm.aggravating.includes(item)}
                      onChange={() => toggleCircumstance('aggravating', item)}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#dc2626]"
                    />
                    <span className="text-[12px] leading-snug text-[#c3c3c3]">{item}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[10px] border border-[#343434]/70 bg-[#181818]/60 px-3.5 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#808080]">
              Entscheidungs-Check
            </p>
            <div className="space-y-1.5">
              {DECISION_CHECKLIST.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={sanctionChecklist[item.key] ?? false}
                    onChange={(e) => setSanctionChecklist((current) => ({ ...current, [item.key]: e.target.checked }))}
                    className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#f59e0b]"
                  />
                  <span className="text-[12.5px] leading-snug text-[#c3c3c3]">{item.label}</span>
                </label>
              ))}
            </div>
            {!sanctionChecklistComplete && (
              <p className="mt-2.5 text-[11.5px] text-[#808080]">
                Alle Punkte müssen bestätigt sein, bevor die Sanktion ausgesprochen werden kann.
              </p>
            )}
          </div>

          {(sanctionForm.penalGrade === '5' || sanctionForm.penalGrade === '6') && (
            <p className="rounded-[9px] border border-[#b45309]/40 bg-[#1d1608]/50 px-3 py-2.5 text-[12px] leading-snug text-[#fbbf24]">
              Penal Grade {sanctionForm.penalGrade}: Die Entscheidung muss anschließend von einer zweiten
              Führungskraft bestätigt werden, bevor die Maßnahme vollzogen werden kann.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={closeSanctionModal}>Abbrechen</Button>
            <Button
              size="sm"
              onClick={handleSanction}
              disabled={!sanctionForm.reason.trim() || !sanctionForm.penalGrade || !sanctionChecklistComplete}
            >
              <Gavel size={13} strokeWidth={2} />
              {editingSanction ? 'Speichern' : 'Sanktion ausstellen'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Promote modal */}
      <Modal open={promoteModal} onClose={() => setPromoteModal(false)} title="Beförderung">
        <div className="space-y-4">
          <div className="px-3 py-2.5 bg-[#212121] rounded-[8px]">
            <p className="text-[13px] text-[#888]">Aktuell: <strong className="text-[#eee]">{agent.rank?.name}</strong></p>
          </div>
          <Select label="Neuer Rang (höher)" value={newRankId} onChange={(e) => setNewRankId(e.target.value)}
            options={higherRanks.map(r => ({ value: r.id, label: r.name }))} placeholder="Rang wählen..." />
          <Input label="Neue DN (optional)" numericOnly value={newBadgeNumber} onChange={(e) => setNewBadgeNumber(e.target.value)} placeholder={`Aktuell: ${displayBadgeNumber(agent.badgeNumber)}`} />
          <Textarea label="Notiz" value={rankChangeNote} onChange={(e) => setRankChangeNote(e.target.value)} rows={2} placeholder="Optional" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPromoteModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={() => handleRankChange('up')} disabled={!newRankId}>Befördern</Button>
          </div>
        </div>
      </Modal>

      {/* Demote modal */}
      <Modal open={demoteModal} onClose={() => setDemoteModal(false)} title="Degradierung">
        <div className="space-y-4">
          <div className="px-3 py-2.5 bg-[#212121] rounded-[8px]">
            <p className="text-[13px] text-[#888]">Aktuell: <strong className="text-[#eee]">{agent.rank?.name}</strong></p>
          </div>
          <Select label="Neuer Rang (niedriger)" value={newRankId} onChange={(e) => setNewRankId(e.target.value)}
            options={lowerRanks.map(r => ({ value: r.id, label: r.name }))} placeholder="Rang wählen..." />
          <Input label="Neue DN (optional)" numericOnly value={newBadgeNumber} onChange={(e) => setNewBadgeNumber(e.target.value)} placeholder={`Aktuell: ${displayBadgeNumber(agent.badgeNumber)}`} />
          <Textarea label="Grund" value={rankChangeNote} onChange={(e) => setRankChangeNote(e.target.value)} rows={2} placeholder="Grund für Degradierung..." />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDemoteModal(false)}>Abbrechen</Button>
            <Button variant="danger" size="sm" onClick={() => handleRankChange('down')} disabled={!newRankId}>Degradieren</Button>
          </div>
        </div>
      </Modal>

      {/* Note modal */}
      <Modal open={noteModal} onClose={() => setNoteModal(false)} title="Notiz hinzufügen">
        <div className="space-y-4">
          <Input label="Titel (optional)" value={noteForm.title} onChange={(e) => setNoteForm({ ...noteForm, title: e.target.value })} />
          <Textarea label="Inhalt" value={noteForm.content} onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })} rows={4} required placeholder="Notiz schreiben..." />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setNoteModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleAddNote} disabled={!noteForm.content.trim()}>Speichern</Button>
          </div>
        </div>
      </Modal>

      {/* Add to rank-change-list modal */}
      <Modal
        open={!!addToListModal}
        onClose={() => setAddToListModal(null)}
        title={addToListModal === 'PROMOTION' ? 'Zur Up-Rank-Liste hinzufügen' : 'Zur D-Rank-Liste hinzufügen'}
      >
        <div className="space-y-4">
          <div className="px-3 py-2.5 bg-[#212121] rounded-[8px]">
            <p className="text-[13px] text-[#888]">
              Agent: <strong className="text-[#eee]">{agent.firstName} {agent.lastName}</strong>
              <span className="ml-2 text-[#999]">· Aktuell: {agent.rank?.name}</span>
            </p>
          </div>
          <Select
            label="Rangänderungsliste"
            value={addToListId}
            onChange={(e) => setAddToListId(e.target.value)}
            options={openRankChangeLists.map(l => ({ value: l.id, label: l.name }))}
            placeholder={openRankChangeLists.length > 0 ? 'Liste wählen...' : 'Keine offene Liste'}
            disabled={openRankChangeLists.length === 0}
          />
          <Select
            label={addToListModal === 'PROMOTION' ? 'Neuer Rang (höher)' : 'Neuer Rang (niedriger)'}
            value={addToListRankId}
            onChange={(e) => setAddToListRankId(e.target.value)}
            options={addToListRanks.map(r => ({ value: r.id, label: r.name }))}
            placeholder="Rang wählen..."
          />
          <Input
            label="Neue DN (optional)"
            numericOnly
            value={addToListBadgeNumber}
            onChange={(e) => setAddToListBadgeNumber(e.target.value)}
            placeholder={`Aktuell: ${displayBadgeNumber(agent.badgeNumber)}`}
          />
          <Input
            label="Notiz (optional)"
            value={addToListNote}
            onChange={(e) => setAddToListNote(e.target.value)}
            placeholder="Optional"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAddToListModal(null)}>Abbrechen</Button>
            <Button size="sm" onClick={handleAddToList} disabled={!addToListId || !addToListRankId}>
              <ListPlus size={13} strokeWidth={2} />
              Hinzufügen
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={absenceModal} onClose={() => setAbsenceModal(false)} title="Abmeldung eintragen">
        <div className="space-y-4">
          <p className="text-[13px] text-[#888]">
            Abmeldung für <strong className="text-[#eee]">{agent.firstName} {agent.lastName}</strong>.
          </p>
          <DateField
            label="Abgemeldet bis"
            value={absenceEndsAt}
            onChange={setAbsenceEndsAt}
            allowClear={false}
          />
          <Textarea
            label="Grund"
            value={absenceReason}
            onChange={(e) => setAbsenceReason(e.target.value)}
            rows={4}
            required
            placeholder="Grund der Abmeldung..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAbsenceModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleAddAbsence} disabled={!absenceReason.trim() || !absenceEndsAt}>
              <Send size={13} strokeWidth={2} />
              Eintragen
            </Button>
          </div>
        </div>
      </Modal>

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
                {agent.firstName} {agent.lastName}
              </p>
              <p className="mt-1 text-[12.5px] text-[#aeaeae]">
                DN {displayBadgeNumber(agent.badgeNumber)} · {agent.rank.name}
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
                  void handleTrainingToggle(pending.training.id, pending.completed, true)
                }}
              >
                Bestätigen
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!sanctionToDelete} onClose={() => setSanctionToDelete(null)} title="Sanktion löschen">
        {sanctionToDelete && (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#7f1d1d]/50 bg-[#2a1212]/60 px-3.5 py-3">
              <p className="text-[13px] font-semibold text-[#fca5a5]">
                {penalGradeLabel(sanctionToDelete.penalGrade)}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[#d2d2d2]">
                {sanctionToDelete.reason}
              </p>
            </div>
            <p className="text-[13px] text-[#aeaeae]">
              Diese Sanktion wird dauerhaft gelöscht.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setSanctionToDelete(null)}>
                Abbrechen
              </Button>
              <Button variant="danger" size="sm" onClick={() => handleDeleteSanction(sanctionToDelete.id)}>
                Löschen
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Arbeitsvertrag + zugehörige Bewerbung auf der Personalakte.
 *
 * Ein unterschriebener Vertrag ist Voraussetzung für die Einstellung — solange
 * er offen ist, steht „Vertragsnachricht senden“ prominent bereit, damit HR den
 * Link jederzeit erneut zustellen kann.
 */
function ContractSection({
  contracts,
  application,
  agentHasDiscordId,
  canManage,
  busy,
  onCreate,
  onSend,
  onCopyLink,
}: {
  contracts: AgentContract[]
  application: LinkedApplication | null
  agentHasDiscordId: boolean
  canManage: boolean
  busy: boolean
  onCreate: () => void
  onSend: (contractId: string) => void
  onCopyLink: (token: string) => void
}) {
  const openContract = contracts.find((c) => c.status === 'DRAFT' || c.status === 'SENT') ?? null
  const signedContract = contracts.find((c) => c.status === 'SIGNED') ?? null

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-[#eee]">Arbeitsvertrag</h3>
        {canManage && !openContract && !signedContract && (
          <Button size="sm" onClick={onCreate} loading={busy}>
            <Send size={13} strokeWidth={1.75} />
            Unterschrift beantragen
          </Button>
        )}
      </div>

      {!signedContract && (
        <div className="mb-3 rounded-[10px] border border-[#7f1d1d]/50 bg-[#2a1620]/50 px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-[#fca5a5]">
            Einstellung noch nicht abgeschlossen
          </p>
          <p className="mt-1 text-[11.5px] leading-5 text-[#f3b7b7]">
            {contracts.length === 0
              ? 'Für diesen Mitarbeiter liegt kein Arbeitsvertrag vor. Beantrage die Unterschrift — der Agent bekommt seinen persönlichen Link per Discord-DM (oder im Vertrags-Channel).'
              : 'Der Arbeitsvertrag ist noch nicht unterschrieben. Erst mit Unterschrift gilt der Mitarbeiter als vollständig eingestellt.'}
          </p>
        </div>
      )}

      {application && (
        <div className="mb-3 rounded-[10px] border border-[#343434]/50 bg-[#181818]/45 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a6a6a6]">
            Zugehörige Bewerbung
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Link
              href="/hr?tab=applications"
              className="text-[13px] font-medium text-white hover:text-[#d4d4d4]"
            >
              {application.applicantDisplayName}
            </Link>
            <span className="text-[11.5px] text-[#909090]">
              eingereicht {formatDate(application.submittedAt)}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-[#a6a6a6]">{application.statusText}</p>
        </div>
      )}

      {contracts.length === 0 ? (
        !agentHasDiscordId ? (
          <p className="text-[12.5px] leading-5 text-[#a6a6a6]">
            Ohne hinterlegte Discord-ID kann keine DM zugestellt werden — die Aufforderung landet
            dann im Vertrags-Channel.
          </p>
        ) : null
      ) : (
        <div className="space-y-2.5">
          {contracts.map((contract) => {
            const meta = CONTRACT_STATUS_META[contract.status]
            const isOpen = contract.status === 'DRAFT' || contract.status === 'SENT'
            return (
              <div
                key={contract.id}
                className="rounded-[10px] border border-[#343434]/50 bg-[#181818]/45 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium text-[#eee]">{contract.title}</p>
                      <Badge variant={meta.variant}>{meta.shortLabel}</Badge>
                    </div>
                    <p className="mt-1 text-[11.5px] text-[#a6a6a6]">
                      {contract.status === 'SIGNED'
                        ? `Unterschrieben am ${formatDateTime(contract.signedAt)} von ${contract.signedName ?? '—'}`
                        : contract.status === 'DECLINED'
                          ? `Abgelehnt am ${formatDateTime(contract.declinedAt)}${contract.declineReason ? ` · ${contract.declineReason}` : ''}`
                          : contract.sentAt
                            ? `Gesendet ${formatDateTime(contract.sentAt)} · ${contract.sentVia === 'channel' ? 'im Channel (DM nicht möglich)' : 'per DM'} · ${contract.sendCount}× versendet`
                            : 'Noch nicht versendet'}
                    </p>
                    {contract.lastSendError && (
                      <p className="mt-1 text-[11.5px] text-[#fca5a5]">{contract.lastSendError}</p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onCopyLink(contract.token)}
                        aria-label="Persönlichen Vertragslink kopieren"
                      >
                        <Download size={13} strokeWidth={1.75} />
                        Link
                      </Button>
                      {isOpen && (
                        <Button size="sm" variant="outline" onClick={() => onSend(contract.id)} loading={busy}>
                          <Send size={13} strokeWidth={1.75} />
                          Vertragsnachricht senden
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!signedContract && openContract && (
        <p className="mt-3 rounded-[10px] border border-[#4a3a12]/50 bg-[#302712]/40 px-3 py-2 text-[11.5px] leading-5 text-[#c6c6c6]">
          Jeder Agent hat seinen eigenen Vertragslink — „Vertragsnachricht senden“ stellt ihn
          erneut per Discord-DM zu.
        </p>
      )}
    </>
  )
}

function InfoRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] text-[#999] mb-1">{label}</p>
      {children || <p className={cn('text-[13.5px] text-[#eee]', mono && 'font-mono')}>{value || '—'}</p>}
    </div>
  )
}

function DutyMetric({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="rounded-[9px] border border-[#373737]/50 bg-[#1c1c1c]/65 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <Timer size={13} className={active ? 'text-[#22c55e]' : 'text-[#d4d4d4]'} strokeWidth={1.75} />
        <p className="text-[11px] font-medium uppercase text-[#808080]">{label}</p>
      </div>
      <p className={cn('mt-2 text-[13px] font-semibold tabular-nums', active ? 'text-[#86efac]' : 'text-[#f4f4f4]')}>{value}</p>
    </div>
  )
}

function PlaytimeChart({
  daily,
}: {
  daily: Array<{ label: string; durationMs: number; durationLabel: string }>
}) {
  const max = Math.max(...daily.map((day) => day.durationMs), 1)
  return (
    <div className="grid grid-cols-7 gap-2 h-[160px] items-end">
      {daily.map((day) => {
        const height = Math.max(8, Math.round((day.durationMs / max) * 118))
        return (
          <div key={day.label} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
            <div className="flex h-[122px] w-full items-end justify-center rounded-[7px] bg-[#080808]/55 px-1">
              <div
                className="w-full max-w-[28px] rounded-t-[6px] bg-gradient-to-t from-[#1d4ed8] to-[#38bdf8] shadow-[0_0_12px_rgba(56,189,248,0.18)]"
                style={{ height }}
                title={day.durationLabel}
              />
            </div>
            <div className="text-center">
              <p className="text-[10.5px] font-medium text-[#a6a6a6]">{day.label}</p>
              <p className="text-[10px] tabular-nums text-[#d4d4d4]">{day.durationLabel}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FlagPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  const buttons: Array<{ id: string | null; label: string; ring: string; bg: string }> = [
    { id: null, label: 'Keine', ring: 'ring-[#404040]', bg: 'bg-[#181818]' },
    { id: 'RED', label: 'Rot', ring: 'ring-[#ef4444]/70', bg: 'bg-[#ef4444]' },
    { id: 'ORANGE', label: 'Orange', ring: 'ring-[#f97316]/70', bg: 'bg-[#f97316]' },
    { id: 'YELLOW', label: 'Gelb', ring: 'ring-[#facc15]/70', bg: 'bg-[#facc15]' },
    { id: 'BLUE', label: 'Blau', ring: 'ring-[#38bdf8]/70', bg: 'bg-[#38bdf8]' },
  ]
  return (
    <div className="flex gap-1.5 flex-wrap">
      {buttons.map((b) => {
        const active = value === b.id
        return (
          <button
            key={String(b.id)}
            type="button"
            onClick={() => onChange(b.id)}
            className={cn(
              'inline-flex items-center gap-2 h-[34px] px-3 rounded-[8px] text-[12.5px] font-medium border transition-all',
              active ? `${b.ring} ring-2 ring-inset border-transparent text-white` : 'border-[#343434]/60 text-[#a6a6a6] hover:text-white hover:border-[#404040]'
            )}
          >
            <span
              className={cn(
                'h-[12px] w-[12px] rounded-full border',
                b.id ? `${b.bg} border-transparent` : 'bg-transparent border-[#808080]'
              )}
            />
            {b.label}
          </button>
        )
      })}
    </div>
  )
}
