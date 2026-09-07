import type {
  InvestigationEntryKindKey,
  InvestigationPersonRoleKey,
  InvestigationPriorityKey,
  InvestigationStatusKey,
} from '@/lib/investigations'

export type RankLite = { id: string; name: string; color: string }

export type AgentLite = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId?: string | null
  rank?: RankLite | null
}

export type UserLite = { id: string; displayName: string }

export type Person = {
  id: string
  personNumber: string
  firstName: string
  lastName: string
  alias: string | null
  identifier: string | null
  dateOfBirth: string | null
  phone: string | null
  photoUrl: string | null
  notes: string | null
  wanted: boolean
  dangerous: boolean
  createdAt: string
  updatedAt: string
  createdBy?: UserLite | null
  _count?: { investigations: number }
}

export type InvestigationPersonLink = {
  id: string
  personId: string
  role: InvestigationPersonRoleKey
  note: string | null
  person: Person
}

export type EntryParticipant = {
  agentId: string | null
  name: string
  badgeNumber: string | null
  rank: string | null
}

export type BodycamClip = {
  id: string
  investigationId: string
  entryId: string | null
  title: string
  description: string | null
  recordedAt: string | null
  location: string | null
  filename: string
  originalName: string
  /// Vom Server als Zahl geliefert (in der Datenbank ein BigInt).
  sizeBytes: number
  mimeType: string
  durationSeconds: number | null
  tags: string[]
  createdAt: string
  recordedByAgent?: AgentLite | null
  uploadedBy?: UserLite | null
  investigation?: {
    id: string
    caseNumber: string
    title: string
    classified: boolean
  } | null
  entry?: { id: string; title: string; kind: InvestigationEntryKindKey } | null
}

export type InvestigationEntry = {
  id: string
  kind: InvestigationEntryKindKey
  title: string
  content: string | null
  occurredAt: string
  location: string | null
  participants: EntryParticipant[]
  createdAt: string
  createdBy?: UserLite | null
  clips: BodycamClip[]
}

export type InvestigationListItem = {
  id: string
  caseNumber: string
  title: string
  summary: string | null
  status: InvestigationStatusKey
  priority: InvestigationPriorityKey
  classified: boolean
  closedAt: string | null
  createdAt: string
  updatedAt: string
  leadAgent: AgentLite | null
  createdBy: UserLite | null
  assignees: { id: string; user: UserLite }[]
  _count: { entries: number; clips: number; persons: number }
}

export type InvestigationDetail = Omit<InvestigationListItem, '_count' | 'assignees'> & {
  assignees: { id: string; userId: string; user: UserLite }[]
  entries: InvestigationEntry[]
  persons: InvestigationPersonLink[]
  clips: BodycamClip[]
}
