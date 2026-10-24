import {
  INVESTIGATION_ENTRY_KIND_LABELS,
  INVESTIGATION_PERSON_ROLE_LABELS,
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
} from '../investigations/investigations'

/**
 * Was ein KI-Vorschlag aus dem Akten-Beitrag an der Akte ändert – Datenform
 * und Anzeige. Reine Funktionen ohne Datenbank; Auflösen und Ausführen steht
 * in `ai-actions.ts`.
 */

export type StatusKey = keyof typeof INVESTIGATION_STATUS_LABELS
type PriorityKey = keyof typeof INVESTIGATION_PRIORITY_LABELS
type EntryKindKey = keyof typeof INVESTIGATION_ENTRY_KIND_LABELS
type PersonRoleKey = keyof typeof INVESTIGATION_PERSON_ROLE_LABELS
export type Named = { id: string; name: string }
/** Agent als Beteiligter am Chronologie-Eintrag (Form wie im Dashboard). */
export type Participant = Named & { badgeNumber: string | null; rank: string | null }

export type ProposalActions = {
  entryKind: EntryKindKey
  status: { from: StatusKey; to: StatusKey } | null
  priority: { from: PriorityKey; to: PriorityKey } | null
  title: { from: string; to: string } | null
  leadAgent: Named | null
  addAssignees: Named[]
  removeAssignees: Named[]
  /** `personId: null` = wird neu im Personenregister angelegt. */
  persons: { personId: string | null; firstName: string; lastName: string; role: PersonRoleKey }[]
  vehicles: Named[]
  /** Am Eintrag beteiligte Agents. */
  participants: Participant[]
  attachments: { images: number; videos: number }
  /** Was die KI genannt hat, aber nicht eindeutig zugeordnet werden konnte. */
  unresolved: string[]
}

export const NO_ACTIONS: ProposalActions = {
  entryKind: 'NOTE', status: null, priority: null, title: null, leadAgent: null,
  addAssignees: [], removeAssignees: [], persons: [], vehicles: [], participants: [], attachments: { images: 0, videos: 0 }, unresolved: [],
}

/** Gespeicherte Aktionen lesen; alte Vorschläge ohne Aktionen ergeben „nichts zu tun“. */
export function readActions(value: unknown): ProposalActions {
  return value && typeof value === 'object' ? { ...NO_ACTIONS, ...(value as Partial<ProposalActions>) } : NO_ACTIONS
}

export function hasChanges(actions: ProposalActions) {
  return Boolean(actions.status || actions.priority || actions.title || actions.leadAgent || actions.addAssignees.length
    || actions.removeAssignees.length || actions.persons.length || actions.vehicles.length)
}

/** Zeilen für die Vorschlagsnachricht. Reine Funktion, damit sie testbar ist. */
export function describeActions(actions: ProposalActions) {
  const lines: string[] = []
  if (actions.status) lines.push(`Status: ${INVESTIGATION_STATUS_LABELS[actions.status.from]} → **${INVESTIGATION_STATUS_LABELS[actions.status.to]}**`)
  if (actions.priority) lines.push(`Priorität: ${INVESTIGATION_PRIORITY_LABELS[actions.priority.from]} → **${INVESTIGATION_PRIORITY_LABELS[actions.priority.to]}**`)
  if (actions.title) lines.push(`Aktentitel: **${actions.title.to}**`)
  if (actions.leadAgent) lines.push(`Fallführung: **${actions.leadAgent.name}**`)
  if (actions.addAssignees.length) lines.push(`Ermittler hinzu: ${actions.addAssignees.map((agent) => agent.name).join(', ')}`)
  if (actions.removeAssignees.length) lines.push(`Ermittler entfernen: ${actions.removeAssignees.map((agent) => agent.name).join(', ')}`)
  for (const person of actions.persons) {
    lines.push(`Person: ${person.firstName} ${person.lastName} (${INVESTIGATION_PERSON_ROLE_LABELS[person.role]})${person.personId ? '' : ' · neu im Register'}`)
  }
  if (actions.vehicles.length) lines.push(`Fahrzeuge: ${actions.vehicles.map((vehicle) => vehicle.name).join(', ')}`)
  if (actions.participants?.length) lines.push(`Beteiligte Agents: ${actions.participants.map((agent) => agent.name).join(', ')}`)
  const { images, videos } = actions.attachments
  if (images || videos) lines.push(`Anhänge: ${[images ? `${images} ${images === 1 ? 'Bild' : 'Bilder'}` : '', videos ? `${videos} ${videos === 1 ? 'Video' : 'Videos'}` : ''].filter(Boolean).join(', ')}`)
  return lines.map((line) => `• ${line}`)
}

/** „Max Muster“ → Vor- und Nachname; der Nachname ist das letzte Wort. */
export function splitName(name: string) {
  const parts = name.replace(/\s+/g, ' ').trim().split(' ')
  if (parts.length < 2) return null
  return { firstName: parts.slice(0, -1).join(' ').slice(0, 100), lastName: parts[parts.length - 1].slice(0, 100) }
}
