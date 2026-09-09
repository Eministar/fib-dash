/**
 * Gruppierung der Audit-Log-Aktionen nach Log-Art. Wird von der API (Filter)
 * und der Protokoll-Seite (Anzeige) gemeinsam genutzt.
 */
export const AUDIT_LOG_GROUPS = {
  agent: {
    label: 'Agent',
    actions: ['AGENT_CREATED', 'AGENT_UPDATED', 'AGENT_DELETED'],
  },
  rank: {
    label: 'Beförderungen & Ränge',
    actions: ['AGENT_PROMOTED', 'AGENT_PROMOTION_REVERTED', 'AGENT_BADGE_REASSIGNED', 'BADGE_NUMBERS_REASSIGNED'],
  },
  termination: {
    label: 'Kündigungen',
    actions: ['AGENT_TERMINATED'],
  },
  sanction: {
    label: 'Sanktionen',
    actions: ['AGENT_SANCTIONED', 'SANCTION_EXECUTED', 'SANCTION_CONFIRMED', 'SANCTION_UPHELD', 'SANCTION_REVOKED', 'SANCTION_UPDATED', 'SANCTION_DELETED'],
  },
  training: {
    label: 'Ausbildung',
    actions: ['TRAININGS_UPDATED'],
  },
  probation: {
    label: 'Probezeit',
    actions: ['PROBATION_STARTED', 'PROBATION_UPDATED', 'PROBATION_DELETED', 'PROBATION_ENTRY_CREATED'],
  },
  note: {
    label: 'Notizen',
    actions: ['NOTE_ADDED', 'INACTIVITY_NOTE_DISMISSED'],
  },
  calendar: {
    label: 'Kalender',
    actions: ['CALENDAR_EVENT_CREATED', 'CALENDAR_EVENT_UPDATED', 'CALENDAR_EVENT_DELETED'],
  },
  internalAffairs: {
    label: 'Internal Affairs',
    actions: ['AGENT_SEARCH_CREATED', 'AGENT_SEARCH_DELETED'],
  },
  legal: {
    label: 'Legal Affairs',
    actions: ['LEGAL_CASE_CREATED', 'LEGAL_CASE_UPDATED', 'LEGAL_CASE_DELETED', 'LEGAL_CASE_BATCH_CREATED'],
  },
  system: {
    label: 'System & API',
    actions: [
      'API_TOKEN_CREATED', 'API_TOKEN_REVOKED', 'API_TOKEN_HARD_DELETED', 'API_TOKENS_LIMIT_UPDATED',
      'CHANGE_UNDONE', 'CHANGE_REDONE',
    ],
  },
} as const

export type AuditLogGroupKey = keyof typeof AUDIT_LOG_GROUPS

export function allGroupedActions(): string[] {
  return Object.values(AUDIT_LOG_GROUPS).flatMap((group) => [...group.actions])
}

/** Aktionen einer Gruppe; null wenn der Key keine bekannte Gruppe ist. */
export function actionsForGroup(group: string): string[] | null {
  if (!(group in AUDIT_LOG_GROUPS)) return null
  return [...AUDIT_LOG_GROUPS[group as AuditLogGroupKey].actions]
}

/** Gruppen-Key zu einer Aktion; 'other' für unbekannte Aktionen. */
export function groupForAction(action: string): AuditLogGroupKey | 'other' {
  for (const [key, group] of Object.entries(AUDIT_LOG_GROUPS)) {
    if ((group.actions as readonly string[]).includes(action)) return key as AuditLogGroupKey
  }
  return 'other'
}
