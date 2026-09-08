import type {
  EvidenceKindKey,
  EvidenceStatusKey,
  InvestigationEntryKindKey,
  InvestigationPersonRoleKey,
  InvestigationPriorityKey,
  InvestigationStatusKey,
  PersonLinkTypeKey,
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
  originalSizeBytes?: number | null
  compressionStatus?: 'PENDING' | 'PROCESSING' | 'COMPRESSED' | 'SKIPPED' | 'FAILED'
  compressionError?: string | null
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

export type Evidence = {
  id: string
  itemNumber: string
  kind: EvidenceKindKey
  status: EvidenceStatusKey
  title: string
  description: string | null
  quantity: number | null
  seizedAt: string | null
  seizedLocation: string | null
  storageLocation: string | null
  photoUrl: string | null
  createdAt: string
  seizedByAgent?: AgentLite | null
  entry?: { id: string; title: string } | null
}

export type Vehicle = {
  id: string
  vehicleNumber: string
  plate: string | null
  model: string | null
  color: string | null
  notes: string | null
  stolen: boolean
  wanted: boolean
  ownerPersonId: string | null
  ownerPerson?: Person | null
  createdAt: string
  _count?: { investigations: number }
}

export type InvestigationVehicleLink = {
  id: string
  vehicleId: string
  note: string | null
  vehicle: Vehicle
}

export type PersonLink = {
  id: string
  type: PersonLinkTypeKey
  note: string | null
  toPerson?: Person
  fromPerson?: Person
}

export type LinkedCase = {
  id: string
  caseNumber: string
  title: string
  status: InvestigationStatusKey
  priority: InvestigationPriorityKey
  classified: boolean
}

export type InvestigationCrossLink = {
  id: string
  note: string | null
  /// Bei `linksFrom` gesetzt, bei `linksTo` steht die Gegenseite in `from`.
  to?: LinkedCase
  from?: LinkedCase
}

export type InvestigationAssignee = {
  id: string
  agentId: string
  createdAt: string
  agent: AgentLite
  addedBy?: UserLite | null
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
  assignees: { id: string; agent: AgentLite }[]
  _count: { entries: number; clips: number; persons: number }
}

export type InvestigationDetail = Omit<InvestigationListItem, '_count' | 'assignees'> & {
  assignees: InvestigationAssignee[]
  entries: InvestigationEntry[]
  persons: InvestigationPersonLink[]
  clips: BodycamClip[]
  evidence: Evidence[]
  vehicles: InvestigationVehicleLink[]
  linksFrom: InvestigationCrossLink[]
  linksTo: InvestigationCrossLink[]
}
