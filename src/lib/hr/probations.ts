export const PROBATION_STATUSES = ['ACTIVE', 'PASSED', 'EXTENDED', 'FAILED'] as const
export const PROBATION_TYPES = ['ROOKIE', 'SERGEANT_SUPERVISOR', 'LEADERSHIP', 'CHIEF'] as const
export const PROBATION_ENTRY_RATINGS = ['POSITIVE', 'NEGATIVE'] as const

export type ProbationStatusValue = (typeof PROBATION_STATUSES)[number]
export type ProbationTypeValue = (typeof PROBATION_TYPES)[number]
export type ProbationEntryRatingValue = (typeof PROBATION_ENTRY_RATINGS)[number]

export const PROBATION_STATUS_LABELS: Record<ProbationStatusValue, string> = {
  ACTIVE: 'Aktiv',
  PASSED: 'Bestanden',
  EXTENDED: 'Verlängert',
  FAILED: 'Nicht bestanden',
}

export const PROBATION_TYPE_LABELS: Record<ProbationTypeValue, string> = {
  ROOKIE: 'Rookie',
  SERGEANT_SUPERVISOR: 'Sergeant / Supervisor',
  LEADERSHIP: 'Leitungsebene',
  CHIEF: 'Chief-Ebene',
}

export const PROBATION_ENTRY_RATING_LABELS: Record<ProbationEntryRatingValue, string> = {
  POSITIVE: 'Positiv',
  NEGATIVE: 'Negativ',
}

export const DEFAULT_CHECKLIST_BY_TYPE: Record<ProbationTypeValue, Array<{ id: string; label: string; completed: boolean }>> = {
  ROOKIE: [
    { id: 'grundausbildung', label: 'Grundausbildung geprüft', completed: false },
    { id: 'dienstzeiten', label: 'Dienstzeiten ausreichend', completed: false },
    { id: 'verhalten', label: 'Verhalten bewertet', completed: false },
    { id: 'abschlussgespraech', label: 'Abschlussgespräch geführt', completed: false },
  ],
  SERGEANT_SUPERVISOR: [
    { id: 'fuehrungsverhalten', label: 'Führungsverhalten beobachtet', completed: false },
    { id: 'teamkommunikation', label: 'Teamkommunikation geprüft', completed: false },
    { id: 'einsatzentscheidungen', label: 'Einsatzentscheidungen bewertet', completed: false },
    { id: 'feedbackgespraech', label: 'Feedbackgespräch geführt', completed: false },
  ],
  LEADERSHIP: [
    { id: 'bereichsverantwortung', label: 'Bereichsverantwortung geprüft', completed: false },
    { id: 'konfliktmanagement', label: 'Konfliktmanagement bewertet', completed: false },
    { id: 'dokumentation', label: 'Dokumentation geprüft', completed: false },
    { id: 'abschlussgespraech', label: 'Abschlussgespräch geführt', completed: false },
  ],
  CHIEF: [
    { id: 'strategie', label: 'Strategische Verantwortung bewertet', completed: false },
    { id: 'department-kommunikation', label: 'Department-Kommunikation geprüft', completed: false },
    { id: 'vorbildfunktion', label: 'Vorbildfunktion bewertet', completed: false },
    { id: 'abschlussentscheidung', label: 'Abschlussentscheidung dokumentiert', completed: false },
  ],
}

export function probationStatus(value: unknown): ProbationStatusValue | null {
  return typeof value === 'string' && (PROBATION_STATUSES as readonly string[]).includes(value)
    ? value as ProbationStatusValue
    : null
}

export function probationType(value: unknown): ProbationTypeValue | null {
  return typeof value === 'string' && (PROBATION_TYPES as readonly string[]).includes(value)
    ? value as ProbationTypeValue
    : null
}

export function probationEntryRating(value: unknown): ProbationEntryRatingValue | null {
  return typeof value === 'string' && (PROBATION_ENTRY_RATINGS as readonly string[]).includes(value)
    ? value as ProbationEntryRatingValue
    : null
}

export function defaultChecklistForProbationType(type: ProbationTypeValue) {
  return DEFAULT_CHECKLIST_BY_TYPE[type].map((item) => ({ ...item }))
}
