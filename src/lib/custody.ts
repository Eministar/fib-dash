/**
 * Beweiskette (Chain of Custody) – Typen und Beschriftungen. Frei von
 * Server-Importen, damit Dialog und Druckansicht sie nutzen können.
 */

export const CUSTODY_ACTIONS = ['CREATED', 'VIEWED', 'UPDATED', 'STATUS_CHANGED', 'TRANSFERRED', 'DELETED'] as const
export type CustodyAction = (typeof CUSTODY_ACTIONS)[number]

export const CUSTODY_ACTION_LABELS: Record<CustodyAction, string> = {
  CREATED: 'Erfasst',
  VIEWED: 'Eingesehen',
  UPDATED: 'Bearbeitet',
  STATUS_CHANGED: 'Status geändert',
  TRANSFERRED: 'Übergeben',
  DELETED: 'Gelöscht',
}

export function custodyActionLabel(action: string) {
  return CUSTODY_ACTION_LABELS[action as CustodyAction] ?? action
}

/** Ein Ansehen pro Nutzer und Zeitraum genügt – sonst flutet jedes Öffnen die Kette. */
export const CUSTODY_VIEW_THROTTLE_MS = 10 * 60_000

export interface CustodyEventDto {
  id: string
  evidenceId: string | null
  itemNumber: string
  action: string
  actorName: string
  fromHolder: string | null
  toHolder: string | null
  location: string | null
  note: string | null
  hash: string
  createdAt: string
}

export interface CustodyIntegrity {
  valid: boolean
  /** Erstes Ereignis, ab dem die Kette nicht mehr stimmt. */
  brokenAtId: string | null
}

export interface CustodyReport {
  evidence: {
    id: string
    itemNumber: string
    title: string
    kind: string
    status: string
    storageLocation: string | null
    seizedAt: string | null
    seizedLocation: string | null
    investigation: { id: string; caseNumber: string; title: string }
  }
  currentHolder: string | null
  events: CustodyEventDto[]
  integrity: CustodyIntegrity
}

/** Aktueller Verwahrer: letzter Empfänger einer Übergabe. */
export function currentHolder(events: readonly Pick<CustodyEventDto, 'action' | 'toHolder'>[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.action === 'TRANSFERRED' && event.toHolder) return event.toHolder
  }
  return null
}
