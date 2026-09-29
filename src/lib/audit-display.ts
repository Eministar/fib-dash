export const auditActionLabels: Record<string, string> = {

  CORRUPTION_CHECK_CREATED: 'Korruptionskontrolle eingetragen',
  CORRUPTION_CHECK_CORRECTED: 'Korruptionskontrolle berichtigt',
  CORRUPTION_OFFICIAL_CREATED: 'Beamter erfasst',
  CORRUPTION_OFFICIAL_EDITED: 'Beamter bearbeitet',
  CORRUPTION_OFFICIAL_MERGED: 'Beamtenakten zusammengeführt',
  DOSSIER_CREATED: 'Dauerakte angelegt',
  DOSSIER_UPDATED: 'Dauerakte bearbeitet',
  DOSSIER_DELETED: 'Dauerakte gelöscht',
  INVESTIGATION_CREATED: 'Einsatzakte angelegt',
  INVESTIGATION_UPDATED: 'Einsatzakte bearbeitet',
  INVESTIGATION_DELETED: 'Einsatzakte gelöscht',
  AGENT_CREATED: 'Erstellt',
  AGENT_UPDATED: 'Bearbeitet',
  AGENT_DELETED: 'Gelöscht',
  AGENT_PROMOTED: 'Befördert',
  AGENT_PROMOTION_REVERTED: 'Beförderung rückgängig',
  AGENT_BADGE_REASSIGNED: 'DN neu vergeben',
  BADGE_NUMBERS_REASSIGNED: 'DN-Neuverteilung',
  AGENT_TERMINATED: 'Gekündigt',
  AGENT_SANCTIONED: 'Sanktioniert',
  SANCTION_EXECUTED: 'Maßnahme vollzogen',
  SANCTION_CONFIRMED: 'Sanktion bestätigt (Vier-Augen)',
  SANCTION_UPHELD: 'Sanktion bestätigt',
  SANCTION_REVOKED: 'Sanktion aufgehoben',
  SANCTION_UPDATED: 'Sanktion bearbeitet',
  SANCTION_DELETED: 'Sanktion gelöscht',
  TRAININGS_UPDATED: 'Ausbildung',
  PROBATION_STARTED: 'Probezeit gestartet',
  PROBATION_UPDATED: 'Probezeit bearbeitet',
  PROBATION_DELETED: 'Probezeit gelöscht',
  NOTE_ADDED: 'Notiz',
  INACTIVITY_NOTE_DISMISSED: 'Fehlzeit-Notiz gelöscht',
  CALENDAR_EVENT_CREATED: 'Termin erstellt',
  CALENDAR_EVENT_UPDATED: 'Termin bearbeitet',
  CALENDAR_EVENT_DELETED: 'Termin gelöscht',
  AGENT_SEARCH_CREATED: 'Durchsuchung eingetragen',
  AGENT_SEARCH_DELETED: 'Durchsuchung gelöscht',
  API_TOKEN_CREATED: 'API-Token erstellt',
  API_TOKEN_REVOKED: 'API-Token widerrufen',
  API_TOKEN_HARD_DELETED: 'API-Token gelöscht',
  API_TOKENS_LIMIT_UPDATED: 'API-Limit geändert',
  LEGAL_CASE_CREATED: 'Klage erstellt',
  LEGAL_CASE_UPDATED: 'Klage bearbeitet',
  LEGAL_CASE_DELETED: 'Klage gelöscht',
  LEGAL_CASE_BATCH_CREATED: 'Sammelklage erstellt',
  CHANGE_UNDONE: 'Änderung rückgängig',
  CHANGE_REDONE: 'Änderung wiederholt',
}

/** Keep technical identifiers in the audit record, not in the activity feed. */
export function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? 'Vorgang aktualisiert'
}

export function auditDetails(value: string | null | undefined) {
  return (value ?? '')
    .replace(/__terminated__[a-z0-9_-]+/gi, '')
    .replace(/\bc[a-z0-9]{20,32}\b/g, '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ :;,–-]+|[ :;,–-]+$/g, '')
    .trim()
}
