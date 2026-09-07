// Bewusst ohne Node-Imports: diese Datei wird auch von Client-Komponenten
// genutzt (Status-Labels, Kinds, Anzeige der Sanktions-Snapshots).
// Die Token- und Aktenzeichen-Erzeugung liegt deshalb in `legal-case-service.ts`.

export const LEGAL_CASE_KINDS = ['SANCTION', 'CUSTOM'] as const
export type LegalCaseKindValue = (typeof LEGAL_CASE_KINDS)[number]

export const LEGAL_CASE_STATUSES = ['DRAFT', 'FILED', 'CLOSED'] as const
export type LegalCaseStatusValue = (typeof LEGAL_CASE_STATUSES)[number]

export const LEGAL_CASE_PREFIX = 'LAD-'

export const LEGAL_CASE_KIND_META: Record<
  LegalCaseKindValue,
  { label: string; description: string }
> = {
  SANCTION: {
    label: 'Sanktionsklage',
    description: 'Automatisch aus einer offenen Sanktion erzeugte Klageschrift.',
  },
  CUSTOM: {
    label: 'Individuelle Klageschrift',
    description: 'Frei verfasste Klageschrift nach eigenem Wortlaut.',
  },
}

export const LEGAL_CASE_STATUS_META: Record<
  LegalCaseStatusValue,
  { label: string; variant: 'default' | 'success' | 'danger' | 'warning' | 'info' }
> = {
  DRAFT: { label: 'Entwurf', variant: 'default' },
  FILED: { label: 'Eingereicht', variant: 'info' },
  CLOSED: { label: 'Geschlossen', variant: 'success' },
}

export function isLegalCaseKind(value: unknown): value is LegalCaseKindValue {
  return typeof value === 'string' && (LEGAL_CASE_KINDS as readonly string[]).includes(value)
}

export interface LegalCaseSanctionSnapshot {
  sanctionId: string
  reason: string
  penalGrade: string
  measureType: string
  fineAmount: number | null
  sgRounds: number | null
  dueAt: string | null
  createdAt: string
}

/** Liest den in der DB als JSON abgelegten Sanktions-Snapshot typisiert zurück. */
export function readLegalCaseSanctions(value: unknown): LegalCaseSanctionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const raw = item as Record<string, unknown>
      return {
        sanctionId: typeof raw.sanctionId === 'string' ? raw.sanctionId : '',
        reason: typeof raw.reason === 'string' ? raw.reason : '',
        penalGrade: typeof raw.penalGrade === 'string' ? raw.penalGrade : '',
        measureType: typeof raw.measureType === 'string' ? raw.measureType : 'FINE',
        fineAmount: typeof raw.fineAmount === 'number' ? raw.fineAmount : null,
        sgRounds: typeof raw.sgRounds === 'number' ? raw.sgRounds : null,
        dueAt: typeof raw.dueAt === 'string' ? raw.dueAt : null,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      } satisfies LegalCaseSanctionSnapshot
    })
    .filter((item): item is LegalCaseSanctionSnapshot => item !== null)
}

/**
 * § 6 des Arbeitsvertrages — die maßgebliche Regelung, auf die sich die
 * Sanktionsklage stützt. Wird beim Erstellen einer Sanktionsklage als
 * Beweismittel in die Klageschrift übernommen (Snapshot).
 */
export const CONTRACT_CLAUSE_6_TITLE = 'Beendigung des Dienstverhältnisses'

export const CONTRACT_CLAUSE_6_BODY = `Das Dienstverhältnis endet durch Kündigung einer der beiden Parteien oder durch Entlassung infolge eines schwerwiegenden Verstoßes gegen die Dienstordnung. Eine fristlose Entlassung bleibt in schweren Fällen vorbehalten.

Eine Kündigung oder Entlassung entbindet nicht von bereits bestehenden Verpflichtungen. Sämtliche zum Zeitpunkt des Ausscheidens offenen Sanktionen, Geldstrafen oder sonstigen Forderungen bleiben bestehen und sind vollständig zu begleichen. Wir behalten uns ausdrücklich das Recht vor, bei ausbleibender Zahlung oder sonstigen Pflichtverletzungen rechtliche Schritte einzuleiten.

Mündliche Nebenabreden bestehen nicht. Sollte eine Bestimmung dieses Vertrages unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.

Mit seiner Unterschrift bestätigt der Mitarbeiter, diesen Vertrag vollständig gelesen, verstanden und akzeptiert zu haben.`
