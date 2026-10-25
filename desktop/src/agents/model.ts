// Typen und Beschriftungen der Agents – gespiegelt aus dem Dashboard
// (src/app/(dashboard)/agents, src/lib/utils.ts, src/lib/sanctions).

import { escapeHtml, initials } from '../dom'

export const STATUS = {
  ACTIVE: 'Aktiv',
  AWAY: 'Abgemeldet',
  ON_LEAVE: 'Beurlaubt',
  INACTIVE: 'Inaktiv',
  TERMINATED: 'Gekündigt',
} as const

export const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'success',
  AWAY: 'brand',
  ON_LEAVE: 'brand',
  INACTIVE: 'subtle',
  TERMINATED: 'danger',
}

export const FLAG = { RED: 'Rot', ORANGE: 'Orange', YELLOW: 'Gelb', BLUE: 'Blau', PURPLE: 'Lila' } as const

export const FLAG_COLOR: Record<string, string> = {
  RED: '#ef4444',
  ORANGE: '#f97316',
  YELLOW: '#facc15',
  BLUE: '#38bdf8',
  PURPLE: '#a855f7',
}

export const SANCTION_STATUS: Record<string, string> = {
  ISSUED: 'Ausgesprochen',
  EXECUTED: 'Vollzogen',
  IN_COURT: 'Einspruch / Klage',
  UPHELD: 'Bestätigt',
  REVOKED: 'Aufgehoben',
}

export const SANCTION_TONE: Record<string, string> = {
  ISSUED: 'warning',
  EXECUTED: 'subtle',
  IN_COURT: 'brand',
  UPHELD: 'danger',
  REVOKED: 'subtle',
}

export interface Rank {
  id: string
  name: string
  sortOrder: number
  color: string
  badgeMin?: number | null
  badgeMax?: number | null
}

export interface Unit { id: string; key: string; name: string; color: string; sortOrder?: number; active?: boolean }

export interface Training {
  id: string
  key: string
  label: string
  sortOrder: number
  minRank: { id: string; name: string; sortOrder: number } | null
}

export interface AgentTraining { id: string; trainingId: string; completed: boolean; training: Training }

/** Zeile der Liste (`GET /api/agents`). */
export interface ListAgent {
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
  onLeave?: boolean
  hireDate: string
  lastOnline: string | null
  discordId: string | null
  avatarUrl: string | null
  trainings: AgentTraining[]
}

export interface Sanction {
  id: string
  reason: string
  penalGrade: string
  level: string
  violationCode: string | null
  penalty: string | null
  status: string
  suspendedUntil: string | null
  executedAt: string | null
  confirmedAt: string | null
  createdAt: string
  issuedBy: { displayName: string } | null
  confirmedBy?: { displayName: string } | null
}

export interface Absence { id: string; startsAt: string; endsAt: string; reason: string; source: string }

export const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Entwurf', tone: 'subtle' },
  SENT: { label: 'Wartet auf Unterschrift', tone: 'warning' },
  SIGNED: { label: 'Unterschrieben', tone: 'success' },
  DECLINED: { label: 'Abgelehnt', tone: 'danger' },
  CANCELLED: { label: 'Zurückgezogen', tone: 'subtle' },
}

export interface Contract {
  id: string
  title: string
  status: string
  sentAt: string | null
  sendCount: number
  lastSendError: string | null
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
  declineReason: string | null
  createdAt: string
}

/** Offene Punkte der Akte (`GET /api/agents/:id/open-tasks`). */
export interface OpenTask { id: string; title: string; detail: string; kind: 'training' | 'contract' | 'task'; dueDate: string | null; overdue?: boolean; inProgress?: boolean }

export interface Achievement { id: string; title: string; description: string; tier: 1 | 2 | 3 }

export interface CodenameHistory {
  current?: { name: string } | null
  prefix?: string
  items: { id: string; assignedAt: string; releasedAt: string | null; releaseReason: string | null; note: string | null; codename?: { name: string }; assignedBy: { displayName: string } | null }[]
}

/** Akte (`GET /api/agents/:id`). */
export interface AgentDetail extends ListAgent {
  promotionBlocked: boolean
  onLeave: boolean
  onLeaveSince: string | null
  onLeaveReason: string | null
  notes: string | null
  phoneNumber: string | null
  hiredBy?: { displayName: string | null; createdAt: string } | null
  discordMember?: { checked: boolean; inGuild: boolean }
  promotionLogs: { id: string; note: string | null; createdAt: string; oldRank: Rank; newRank: Rank; performedBy: { displayName: string } | null }[]
  sanctions: Sanction[]
  agentNotes: { id: string; title: string | null; content: string; createdAt: string; author: { displayName: string } | null }[]
  dutyTime?: {
    activeSession: { clockInAt: string; currentDurationMs: number } | null
    weekDurationMs: number
    playtimeWeekDurationMs: number
    totalDurationMs: number
    sessionCount: number
    averageSessionMs: number
    longestSessionMs: number
    lastSeenAt: string | null
  }
  playtime?: {
    daily: { date: string; label: string; durationMs: number; durationLabel: string }[]
    recentSessions: { id: string; startedAt: string; endedAt: string | null; lastSeenAt: string; playerName: string; durationMs: number }[]
  }
  absences?: { active: Absence | null; upcoming: Absence[]; recent: Absence[] }
  contracts?: Contract[]
  jobApplication?: { id: string; applicantDisplayName: string; statusText: string; submittedAt: string } | null
}

export interface RecordEntry { id: string; kind: 'POSITIVE' | 'NEGATIVE'; title: string; content: string | null; source: string; createdAt: string; author: string | null }
export interface Records { entries: RecordEntry[]; positive: number; negative: number }

export interface LicenseRow {
  license: { id: string; label: string; description: string | null; cooldownDays: number }
  state: 'NONE' | 'GRANTED' | 'REVOKED'
  regainableAt: string | null
}

export interface LicenseHistory {
  id: string
  licenseLabel: string
  action: 'GRANTED' | 'REVOKED'
  reason: string | null
  regainableAt: string | null
  overrodeCooldown: boolean
  bulk: boolean
  sanction: { label: string } | null
  actorName: string | null
  createdAt: string
}

export interface Licenses { licenses: LicenseRow[]; history: LicenseHistory[]; sanctions: { id: string; label: string }[] }

export interface TimelineEntry {
  id: string
  category: string
  tone: 'positive' | 'negative' | 'neutral'
  title: string
  description: string | null
  occurredAt: string
  details: { label: string; value: string }[]
}

export function agentName(agent: { firstName: string; lastName: string }) {
  return `${agent.firstName} ${agent.lastName}`
}

/** Dienstnummer wie im Dashboard: führende Null bei einstelligen Nummern. */
export function badgeNumber(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return '—'
  return trimmed.replace(/(\d+)$/, (digits) => digits.padStart(2, '0'))
}

export function compareBadgeNumbers(a: string, b: string) {
  const na = parseInt(a.match(/\d+/)?.[0] ?? '', 10)
  const nb = parseInt(b.match(/\d+/)?.[0] ?? '', 10)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1
  return a.localeCompare(b, 'de')
}

export function unitKeys(agent: { units?: string[] | null; unit?: string | null }) {
  const units = Array.isArray(agent.units) ? agent.units.filter(Boolean) : []
  return units.length ? units : agent.unit ? [agent.unit] : []
}

export function avatar(agent: { firstName: string; lastName: string; avatarUrl?: string | null }, size = '') {
  const image = agent.avatarUrl ? `<img class="avatar-img" src="${escapeHtml(agent.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''
  return `<span class="avatar ${size}">${escapeHtml(initials(agentName(agent)))}${image}</span>`
}

export function durationLabel(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes % 60} min`
}

export function options<T extends Record<string, string>>(labels: T) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}
