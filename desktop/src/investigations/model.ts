// Typen und Beschriftungen der Ermittlungsakten – gespiegelt aus dem Dashboard
// (src/components/investigations/types.ts, src/lib/investigations/investigations.ts).

import { escapeHtml, initials } from '../dom'
import { state } from '../store'

export const STATUS = {
  OPEN: 'Offen',
  ACTIVE: 'In Bearbeitung',
  SUSPENDED: 'Ruhend',
  CLOSED: 'Abgeschlossen',
  ARCHIVED: 'Archiviert',
} as const

export const PRIORITY = { LOW: 'Niedrig', NORMAL: 'Normal', HIGH: 'Hoch', CRITICAL: 'Kritisch' } as const

export const ENTRY_KIND = {
  OPERATION: 'Einsatz',
  INTERROGATION: 'Vernehmung',
  OBSERVATION: 'Observation',
  EVIDENCE: 'Beweismittel',
  NOTE: 'Notiz',
  RESULT: 'Ergebnis',
} as const

export const PERSON_ROLE = {
  SUSPECT: 'Verdächtiger',
  WITNESS: 'Zeuge',
  VICTIM: 'Geschädigter',
  INFORMANT: 'Informant',
  ACCOMPLICE: 'Mittäter',
  OTHER: 'Sonstiges',
} as const

export const EVIDENCE_KIND = {
  WEAPON: 'Waffe',
  DRUGS: 'Betäubungsmittel',
  MONEY: 'Bargeld',
  DOCUMENT: 'Dokument',
  ELECTRONICS: 'Elektronik',
  CLOTHING: 'Kleidung',
  BIOLOGICAL: 'Biologische Spur',
  VEHICLE_PART: 'Fahrzeugteil',
  OTHER: 'Sonstiges',
} as const

export const EVIDENCE_STATUS = {
  SECURED: 'Sichergestellt',
  IN_ANALYSIS: 'In Auswertung',
  RELEASED: 'Herausgegeben',
  DESTROYED: 'Vernichtet',
  LOST: 'Abhanden',
} as const

export type StatusKey = keyof typeof STATUS
export type PriorityKey = keyof typeof PRIORITY

/** Farbton je Status/Priorität für Badges (Fluent-Palette). */
export const STATUS_TONE: Record<StatusKey, string> = {
  OPEN: 'brand',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'subtle',
  ARCHIVED: 'subtle',
}

export const PRIORITY_TONE: Record<PriorityKey, string> = {
  LOW: 'subtle',
  NORMAL: 'subtle',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

export function options<T extends Record<string, string>>(labels: T) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

export type Agent = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank?: { id: string; name: string; color: string } | null
}

export type User = { id: string; displayName: string }

export type Person = {
  id: string
  personNumber: string
  firstName: string
  lastName: string
  occupation?: string | null
  organization?: string | null
  rank?: string | null
  photoCrop?: { x: number; y: number; zoom: number } | null
  alias: string | null
  identifier: string | null
  dateOfBirth: string | null
  phone: string | null
  photoId?: string | null
  photoUrl: string | null
  notes: string | null
  wanted: boolean
  dangerous: boolean
}

export type Vehicle = {
  photoId?: string | null
  ownerPersonId?: string | null
  id: string
  vehicleNumber: string
  plate: string | null
  model: string | null
  color: string | null
  notes: string | null
  stolen: boolean
  wanted: boolean
  ownerPerson?: Person | null
}

export type Clip = {
  id: string
  title: string
  description: string | null
  recordedAt: string | null
  location: string | null
  mimeType: string
  sizeBytes: number
  durationSeconds: number | null
  compressionStatus?: string
  tags: string[]
  createdAt: string
  recordedByAgent?: Agent | null
  uploadedBy?: User | null
  entry?: { id: string; title: string } | null
}

export type Evidence = {
  id: string
  itemNumber: string
  kind: keyof typeof EVIDENCE_KIND
  status: keyof typeof EVIDENCE_STATUS
  title: string
  description: string | null
  quantity: number | null
  seizedAt: string | null
  seizedLocation: string | null
  storageLocation: string | null
  photoId?: string | null
  photoUrl: string | null
  createdAt: string
  seizedByAgent?: Agent | null
  entry?: { id: string; title: string } | null
}

export type Participant = { agentId: string | null; name: string; badgeNumber: string | null; rank: string | null }

export type Entry = {
  id: string
  kind: keyof typeof ENTRY_KIND
  title: string
  content: string | null
  occurredAt: string
  location: string | null
  participants: Participant[]
  createdAt: string
  createdBy?: User | null
  clips: Clip[]
}

export type LinkedCase = { id: string; caseNumber: string; title: string; status: StatusKey; priority: PriorityKey }

export type ChecklistItem = { id: string; label: string; done: boolean; doneAt: string | null; doneBy: string | null }
export type OpenRole = { id: string; role: keyof typeof PERSON_ROLE; label: string }

export type ListItem = {
  id: string
  caseNumber: string
  title: string
  summary: string | null
  status: StatusKey
  priority: PriorityKey
  closedAt: string | null
  createdAt: string
  updatedAt: string
  leadAgent: Agent | null
  assignees: { id: string; agent: Agent }[]
  checklist: unknown
  _count: { entries: number; clips: number; persons: number }
}

export type MapSpotRef = { id: string; title: string; category: string; icon: string | null; x: number; y: number }

export type CorruptionCheckRef = {
  id: string
  conductedAt: string
  result: string
  location: string | null
  official: { id: number; firstName: string; lastName: string; agency: string }
}

export type Detail = Omit<ListItem, '_count' | 'assignees'> & {
  createdBy: User | null
  template: { id: string; name: string } | null
  openRoles: unknown
  assignees: { id: string; agentId: string; createdAt: string; agent: Agent; addedBy?: User | null }[]
  entries: Entry[]
  persons: { id: string; personId: string; role: keyof typeof PERSON_ROLE; note: string | null; person: Person }[]
  clips: Clip[]
  evidence: Evidence[]
  vehicles: { id: string; vehicleId: string; note: string | null; vehicle: Vehicle }[]
  photos: { id: string; title: string; createdAt: string }[]
  linksFrom: { id: string; note: string | null; to?: LinkedCase }[]
  linksTo: { id: string; note: string | null; from?: LinkedCase }[]
  mapSpots: MapSpotRef[]
  corruptionChecks: { check: CorruptionCheckRef }[]
  crossHits?: unknown
}

export type HistoryItem = { id: string; action: string; details: string | null; createdAt: string; userName: string }

export type CustodyEvent = {
  id: string
  action: string
  actorName: string | null
  fromHolder: string | null
  toHolder: string | null
  location: string | null
  note: string | null
  createdAt: string
}

export type Custody = { currentHolder: string | null; events: CustodyEvent[]; integrity?: { valid?: boolean } | unknown }

/** Wie displayBadgeNumber im Dashboard: Ziffern mindestens zweistellig. */
export function badge(badgeNumber: string | null | undefined) {
  const visible = (badgeNumber ?? '').split('__terminated__')[0].trim()
  return visible ? visible.replace(/(\d+)$/, (digits) => digits.padStart(2, '0')) : '—'
}

export function agentName(agent: Agent | null | undefined) {
  if (!agent) return '–'
  return `${agent.firstName} ${agent.lastName} (${badge(agent.badgeNumber)})`
}

/** Rundes Agent-Bild: Discord-Profilbild, solange es lädt bzw. fehlt die Initialen. */
export function agentAvatar(agent: { id?: string | null; firstName?: string; lastName?: string; name?: string } | null | undefined, size: 'xs' | 'small' | 'large' = 'large') {
  if (!agent) return ''
  const name = agent.name ?? `${agent.firstName ?? ''} ${agent.lastName ?? ''}`
  const url = agent.id ? state.context?.agentAvatars?.[agent.id] : undefined
  return `<span class="avatar ${size}">${escapeHtml(initials(name))}${url ? `<img class="avatar-img" src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`
}

export function personName(person: Person) {
  return `${person.firstName} ${person.lastName}${person.alias ? ` „${person.alias}“` : ''}`
}

export function checklistOf(value: unknown): ChecklistItem[] {
  return Array.isArray(value) ? (value as ChecklistItem[]).filter((i) => i && typeof i.id === 'string') : []
}

export function openRolesOf(value: unknown): OpenRole[] {
  return Array.isArray(value) ? (value as OpenRole[]).filter((r) => r && typeof r.id === 'string') : []
}

export const CUSTODY_ACTION: Record<string, string> = {
  CREATED: 'Erfasst',
  VIEWED: 'Eingesehen',
  UPDATED: 'Bearbeitet',
  STATUS_CHANGED: 'Status geändert',
  TRANSFERRED: 'Übergeben',
  DELETED: 'Gelöscht',
}
