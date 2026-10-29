import type { CurrentUser } from '@/lib/auth'
// Nur als Typ importiert: die Datei wird auch von Client-Komponenten für die
// Label-Tabellen genutzt und darf den Prisma-Client nicht ins Bundle ziehen.
import type { Prisma } from '@/generated/prisma'

export const INVESTIGATION_CASE_PREFIX = 'ERM-'
export const PERSON_NUMBER_PREFIX = 'PER-'
export const EVIDENCE_NUMBER_PREFIX = 'ASV-'
export const VEHICLE_NUMBER_PREFIX = 'FZG-'

export const INVESTIGATION_STATUS_LABELS = {
  OPEN: 'Offen',
  ACTIVE: 'In Bearbeitung',
  SUSPENDED: 'Ruhend',
  CLOSED: 'Abgeschlossen',
  ARCHIVED: 'Archiviert',
} as const

export const INVESTIGATION_PRIORITY_LABELS = {
  LOW: 'Niedrig',
  NORMAL: 'Normal',
  HIGH: 'Hoch',
  CRITICAL: 'Kritisch',
} as const

export const INVESTIGATION_ENTRY_KIND_LABELS = {
  OPERATION: 'Einsatz',
  INTERROGATION: 'Vernehmung',
  OBSERVATION: 'Observation',
  EVIDENCE: 'Beweismittel',
  NOTE: 'Notiz',
  RESULT: 'Ergebnis',
} as const

export const INVESTIGATION_PERSON_ROLE_LABELS = {
  SUSPECT: 'Verdächtiger',
  WITNESS: 'Zeuge',
  VICTIM: 'Geschädigter',
  INFORMANT: 'Informant',
  ACCOMPLICE: 'Mittäter',
  OTHER: 'Sonstiges',
} as const

export const EVIDENCE_KIND_LABELS = {
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

export const EVIDENCE_STATUS_LABELS = {
  SECURED: 'Sichergestellt',
  IN_ANALYSIS: 'In Auswertung',
  RELEASED: 'Herausgegeben',
  DESTROYED: 'Vernichtet',
  LOST: 'Abhanden',
} as const

export const PERSON_LINK_TYPE_LABELS = {
  FAMILY: 'Familie',
  ASSOCIATE: 'Umfeld',
  EMPLOYER: 'Arbeitgeber von',
  RIVAL: 'Rivale',
  PARTNER: 'Partner',
  MEMBER_OF: 'Mitglied bei',
  CONTACT: 'Kontakt',
  OTHER: 'Sonstiges',
} as const

export type EvidenceKindKey = keyof typeof EVIDENCE_KIND_LABELS
export type EvidenceStatusKey = keyof typeof EVIDENCE_STATUS_LABELS
export type PersonLinkTypeKey = keyof typeof PERSON_LINK_TYPE_LABELS

export function isEvidenceKind(value: unknown): value is EvidenceKindKey {
  return typeof value === 'string' && value in EVIDENCE_KIND_LABELS
}

export function isEvidenceStatus(value: unknown): value is EvidenceStatusKey {
  return typeof value === 'string' && value in EVIDENCE_STATUS_LABELS
}

export function isPersonLinkType(value: unknown): value is PersonLinkTypeKey {
  return typeof value === 'string' && value in PERSON_LINK_TYPE_LABELS
}

export type InvestigationStatusKey = keyof typeof INVESTIGATION_STATUS_LABELS
export type InvestigationPriorityKey = keyof typeof INVESTIGATION_PRIORITY_LABELS
export type InvestigationEntryKindKey = keyof typeof INVESTIGATION_ENTRY_KIND_LABELS
export type InvestigationPersonRoleKey = keyof typeof INVESTIGATION_PERSON_ROLE_LABELS

export function isInvestigationStatus(value: unknown): value is InvestigationStatusKey {
  return typeof value === 'string' && value in INVESTIGATION_STATUS_LABELS
}

export function isInvestigationPriority(value: unknown): value is InvestigationPriorityKey {
  return typeof value === 'string' && value in INVESTIGATION_PRIORITY_LABELS
}

export function isInvestigationEntryKind(value: unknown): value is InvestigationEntryKindKey {
  return typeof value === 'string' && value in INVESTIGATION_ENTRY_KIND_LABELS
}

export function isInvestigationPersonRole(value: unknown): value is InvestigationPersonRoleKey {
  return typeof value === 'string' && value in INVESTIGATION_PERSON_ROLE_LABELS
}

const agentSelect = {
  id: true,
  firstName: true,
  lastName: true,
  badgeNumber: true,
  discordId: true,
  rank: { select: { id: true, name: true, color: true } },
} as const

const userSelect = { id: true, displayName: true } as const

/// Kopf einer querverwiesenen Akte – bewusst ohne Inhalte, die Verweisliste
/// soll keine Details einer fremden Akte durchreichen.
const linkedCaseSelect = {
  id: true,
  caseNumber: true,
  title: true,
  status: true,
  priority: true,
} as const

/// Kopf der Korruptionskontrolle, die Anlass einer Akte ist; Befunde stehen in der Kontrolle selbst.
export const linkedCorruptionCheckSelect = {
  id: true,
  conductedAt: true,
  result: true,
  location: true,
  official: { select: { id: true, firstName: true, lastName: true, agency: true } },
} as const

export const investigationListInclude = {
  leadAgent: { select: agentSelect },
  createdBy: { select: userSelect },
  assignees: { select: { id: true, agent: { select: agentSelect } } },
  _count: { select: { entries: true, clips: true, persons: true } },
} as const

export const investigationDetailInclude = {
  leadAgent: { select: agentSelect },
  createdBy: { select: userSelect },
  template: { select: { id: true, name: true } },
  corruptionCheck: { select: linkedCorruptionCheckSelect },
  assignees: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      agentId: true,
      createdAt: true,
      agent: { select: agentSelect },
      addedBy: { select: userSelect },
    },
  },
  entries: {
    orderBy: [{ occurredAt: 'desc' }],
    include: {
      createdBy: { select: userSelect },
      clips: { orderBy: [{ createdAt: 'asc' }] },
    },
  },
  persons: {
    orderBy: [{ createdAt: 'asc' }],
    include: { person: true },
  },
  clips: {
    orderBy: [{ createdAt: 'desc' }],
    include: {
      recordedByAgent: { select: agentSelect },
      uploadedBy: { select: userSelect },
    },
  },
  evidence: {
    orderBy: [{ createdAt: 'asc' }],
    include: {
      seizedByAgent: { select: agentSelect },
      entry: { select: { id: true, title: true } },
    },
  },
  vehicles: {
    orderBy: [{ createdAt: 'asc' }],
    include: { vehicle: { include: { ownerPerson: true } } },
  },
  mapSpots: {
    orderBy: [{ title: 'asc' }],
    select: { id: true, title: true, category: true, icon: true, x: true, y: true },
  },
  photos: {
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, title: true, description: true, createdAt: true, uploadedById: true },
  },
  linksFrom: {
    orderBy: [{ createdAt: 'asc' }],
    include: { to: { select: linkedCaseSelect } },
  },
  linksTo: {
    orderBy: [{ createdAt: 'asc' }],
    include: { from: { select: linkedCaseSelect } },
  },
} as const satisfies Prisma.InvestigationInclude

/// Standard-Include fuer Asservate; ueberall identisch, damit die Clients
/// dieselbe Form bekommen.
export const evidenceInclude = {
  seizedByAgent: { select: agentSelect },
  entry: { select: { id: true, title: true } },
} as const satisfies Prisma.EvidenceInclude

/**
 * Früher die Felder für die Verschlusssachen-Prüfung. Verschlusssachen gibt
 * es nicht mehr; das leere Include bleibt, damit die Aufrufer unverändert
 * bleiben und eine spätere Zugriffsregel nur hier ansetzen muss.
 */
export const investigationAccessInclude = {} as const satisfies Prisma.InvestigationInclude

/// Minimale Felder, die `canAccessInvestigation` benötigt.
export type InvestigationAccessShape = object

function viewerAgentWhere(user: CurrentUser): Prisma.AgentWhereInput {
  return {
    status: { not: 'TERMINATED' },
    OR: [{ userId: user.id }, ...(user.discordId ? [{ discordId: user.discordId }] : [])],
  }
}

/**
 * Jede Akte ist für alle mit `investigations:view` sichtbar – Verschlusssachen
 * wurden abgeschafft. Die Funktion bleibt als einzige Stelle für Aktenzugriff,
 * die Rechteprüfung selbst übernimmt `requirePermission` in den Routen.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur bleibt für alle Aufrufer gleich.
export function canAccessInvestigation(_user: CurrentUser, _investigation: InvestigationAccessShape) {
  return true
}

/** Listenfilter zur Sichtbarkeit; ohne Verschlusssachen gibt es nichts auszublenden. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Signatur bleibt für alle Aufrufer gleich.
export function investigationVisibilityWhere(_user: CurrentUser): Prisma.InvestigationWhereInput {
  return {}
}

/**
 * „Meine Akten“: Fallführung oder Zuweisung über das eigene Agent-Profil
 * (verknüpftes Konto oder gleiche Discord-ID). Ersetzt nicht die
 * Sichtbarkeitsprüfung, sondern wird zusätzlich angehängt.
 */
export function myInvestigationsWhere(user: CurrentUser): Prisma.InvestigationWhereInput {
  const self = viewerAgentWhere(user)
  return { OR: [{ leadAgent: self }, { assignees: { some: { agent: self } } }] }
}

/** Text des Chronologie-Eintrags bei einer Übergabe der Fallführung. */
export function handoverEntryContent(previous: string | null, next: string | null, note: string) {
  const line = previous ? `Fallführung von ${previous} an ${next ?? '—'} übergeben.` : `Fallführung an ${next ?? '—'} übergeben.`
  return `${line}\n\n${note.trim()}`
}

/**
 * `BodycamClip.sizeBytes` ist ein BigInt und damit nicht JSON-serialisierbar.
 * Alle API-Antworten laufen deshalb durch diese Normalisierung.
 */
export function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as unknown as T
  if (Array.isArray(value)) return value.map((item) => serializeBigInts(item)) as unknown as T
  if (value instanceof Date) return value
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeBigInts(item)
    }
    return result as T
  }
  return value
}

export interface EntryParticipant {
  agentId: string | null
  name: string
  badgeNumber: string | null
  rank: string | null
}

export function sanitizeParticipants(value: unknown): EntryParticipant[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      if (!name) return null
      return {
        agentId: typeof raw.agentId === 'string' && raw.agentId.trim() ? raw.agentId.trim() : null,
        name: name.slice(0, 200),
        badgeNumber:
          typeof raw.badgeNumber === 'string' && raw.badgeNumber.trim()
            ? raw.badgeNumber.trim().slice(0, 64)
            : null,
        rank: typeof raw.rank === 'string' && raw.rank.trim() ? raw.rank.trim().slice(0, 120) : null,
      }
    })
    .filter((item): item is EntryParticipant => item !== null)
    .slice(0, 50)
}

export function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const tag = item.trim().slice(0, 40)
    if (tag) seen.add(tag)
    if (seen.size >= 20) break
  }
  return Array.from(seen)
}

/**
 * Prüft eine Liste von Fremdschlüsseln aus dem Request-Body. Duplikate
 * fliegen raus, damit ein doppelt geschickter Eintrag nicht als
 * Verknüpfungsfehler beim Datenbankschreiben endet.
 */
export function validateIdList(value: unknown, max = 200): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Ungültige Liste')
  if (value.length > max) throw new Error(`Zu viele Einträge (max. ${max})`)
  const ids = value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
  if (ids.some((entry) => !entry || entry.length > 191)) throw new Error('Ungültige Liste')
  return [...new Set(ids)]
}
