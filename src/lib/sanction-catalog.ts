/**
 * Sanktionskatalog des Federal Investigation Bureau — Version 1.0.
 *
 * Interner Dienststandard. Die Penal Grades (1–6) bilden die Schwere eines
 * Verstoßes ab, die Sanktionsstufen (01–07) die daraus folgende Maßnahme.
 * Maßgeblich bleiben die jeweils geltenden Dienstvorschriften; dieser Katalog
 * ist Orientierungs- und Entscheidungsrahmen. Sanktionen sind stets nach dem
 * Grundsatz der Verhältnismäßigkeit zu wählen.
 */

export type PenalGrade = '1' | '2' | '3' | '4' | '5' | '6'
export type SanctionLevel = '01' | '02' | '03' | '04' | '05' | '06' | '07'

/** Stellen, die eine Sanktionsstufe aussprechen dürfen (Abschnitt 05). */
export type SanctionAuthority =
  | 'DIRECT_SUPERVISOR'
  | 'LEADERSHIP'
  | 'DEPARTMENT_HEAD'
  | 'FIB_LEADERSHIP'
  | 'CHIEF_LEVEL'

export interface SanctionAuthorityRule {
  key: SanctionAuthority
  label: string
  /** Befugnis laut Katalog. */
  scope: string
  /**
   * Standard-Mindestrang (Rank.sortOrder; kleiner = höher). Wird beim Seed in
   * `SanctionLevelAuthority` geschrieben und ist dort pro Stufe anpassbar.
   */
  defaultMinRankSortOrder: number
}

export interface SanctionLevelRule {
  level: SanctionLevel
  /** Kurzbezeichnung der Maßnahme, z. B. "Schriftliche Verwarnung". */
  measure: string
  /** Anwendungshinweis aus Abschnitt 02. */
  application: string
  authority: SanctionAuthority
  /** Maßnahme beendet das Dienstverhältnis. */
  terminates: boolean
  /** Maßnahme setzt den Dienst vorübergehend aus. */
  suspends: boolean
  /** Maßnahme stuft im Rang zurück. */
  demotes: boolean
}

export interface SanctionViolation {
  /** Stabiler Code, z. B. "pg2.unpuenktlichkeit". Basis der Wiederholungsprüfung. */
  code: string
  grade: PenalGrade
  label: string
}

export interface PenalGradeRule {
  grade: PenalGrade
  /** Schwere, z. B. "Sehr schwer". */
  severity: string
  /** Kurzbeschreibung aus Abschnitt 01. */
  description: string
  /** Typische Folge aus Abschnitt 01. */
  typicalConsequence: string
  /** Regelsanktion(en) nach Abschnitt 03. Mehrere = Auswahl nach Einzelfall. */
  regularLevels: SanctionLevel[]
  /** Folge bei Wiederholung nach Abschnitt 03. */
  repeatConsequence: string
}

// ---------------------------------------------------------------------------
// 05 — Zuständigkeiten
// ---------------------------------------------------------------------------

export const SANCTION_AUTHORITIES: Record<SanctionAuthority, SanctionAuthorityRule> = {
  DIRECT_SUPERVISOR: {
    key: 'DIRECT_SUPERVISOR',
    label: 'Direkter Vorgesetzter',
    scope: 'Mündliche Verwarnung',
    defaultMinRankSortOrder: 7,
  },
  LEADERSHIP: {
    key: 'LEADERSHIP',
    label: 'Führungsebene',
    scope: 'Schriftliche Verwarnung / Disziplinarmaßnahmen',
    defaultMinRankSortOrder: 6,
  },
  DEPARTMENT_HEAD: {
    key: 'DEPARTMENT_HEAD',
    label: 'Abteilungsleitung',
    scope: 'Degradierung / Suspendierung',
    defaultMinRankSortOrder: 5,
  },
  FIB_LEADERSHIP: {
    key: 'FIB_LEADERSHIP',
    label: 'FIB-Leitung',
    scope: 'Schwere Disziplinarmaßnahmen / Entlassung',
    defaultMinRankSortOrder: 4,
  },
  CHIEF_LEVEL: {
    key: 'CHIEF_LEVEL',
    label: 'Direktor / Chief-Ebene',
    scope: 'Penal Grade 5–6 / endgültige Personalentscheidungen',
    defaultMinRankSortOrder: 3,
  },
}

// ---------------------------------------------------------------------------
// 02 — Sanktionsstufen
// ---------------------------------------------------------------------------

export const SANCTION_LEVELS: Record<SanctionLevel, SanctionLevelRule> = {
  '01': {
    level: '01',
    measure: 'Mündliche Verwarnung',
    application: 'Direkter Hinweis auf das Fehlverhalten; keine formelle Disziplinarmaßnahme.',
    authority: 'DIRECT_SUPERVISOR',
    terminates: false,
    suspends: false,
    demotes: false,
  },
  '02': {
    level: '02',
    measure: 'Schriftliche Verwarnung',
    application: 'Dokumentierte Verwarnung und Eintrag in die Personalakte.',
    authority: 'LEADERSHIP',
    terminates: false,
    suspends: false,
    demotes: false,
  },
  '03': {
    level: '03',
    measure: 'Disziplinarmaßnahme',
    application: 'Formeller Disziplinareintrag; gegebenenfalls Entzug einzelner Befugnisse.',
    authority: 'LEADERSHIP',
    terminates: false,
    suspends: false,
    demotes: false,
  },
  '04': {
    level: '04',
    measure: 'Degradierung',
    application: 'Rückstufung um einen oder mehrere Ränge beziehungsweise Entzug von Sonderberechtigungen.',
    authority: 'DEPARTMENT_HEAD',
    terminates: false,
    suspends: false,
    demotes: true,
  },
  '05': {
    level: '05',
    measure: 'Suspendierung',
    application: 'Vorübergehende Entbindung vom Dienst; Dauer nach Einzelfall.',
    authority: 'DEPARTMENT_HEAD',
    terminates: false,
    suspends: true,
    demotes: false,
  },
  '06': {
    level: '06',
    measure: 'Entlassung',
    application: 'Beendigung der Tätigkeit beim FIB.',
    authority: 'FIB_LEADERSHIP',
    terminates: true,
    suspends: false,
    demotes: false,
  },
  '07': {
    level: '07',
    measure: 'Sofortige Entlassung',
    application: 'Bei besonders schweren Verstößen; vorherige Verwarnung nicht erforderlich.',
    authority: 'CHIEF_LEVEL',
    terminates: true,
    suspends: false,
    demotes: false,
  },
}

/** Sanktionsstufen in aufsteigender Schwere. */
export const SANCTION_LEVEL_ORDER: SanctionLevel[] = ['01', '02', '03', '04', '05', '06', '07']

// ---------------------------------------------------------------------------
// 01 — Penal Grades
// ---------------------------------------------------------------------------

export const PENAL_GRADE_RULES: Record<PenalGrade, PenalGradeRule> = {
  '1': {
    grade: '1',
    severity: 'Geringfügig',
    description: 'Leichte Regelverstöße ohne wesentliche Folgen.',
    typicalConsequence: 'Hinweis / Verwarnung',
    regularLevels: ['01'],
    repeatConsequence: 'Wiederholung → grundsätzlich schriftliche Verwarnung',
  },
  '2': {
    grade: '2',
    severity: 'Leicht',
    description: 'Erkennbarer Verstoß gegen interne Abläufe oder Verhalten.',
    typicalConsequence: 'Schriftliche Verwarnung',
    regularLevels: ['02'],
    repeatConsequence: 'Wiederholung → Disziplinarmaßnahme, gegebenenfalls Degradierung',
  },
  '3': {
    grade: '3',
    severity: 'Mittel',
    description: 'Deutlicher Verstoß gegen Dienst- oder Verhaltenspflichten.',
    typicalConsequence: 'Disziplinarmaßnahme',
    regularLevels: ['03'],
    repeatConsequence: 'Wiederholung → Degradierung / Suspendierung',
  },
  '4': {
    grade: '4',
    severity: 'Schwer',
    description: 'Erhebliche Pflichtverletzung oder erheblicher Vertrauensschaden.',
    typicalConsequence: 'Degradierung / Suspendierung',
    regularLevels: ['04', '05'],
    repeatConsequence: 'Wiederholung → Suspendierung / Entlassung',
  },
  '5': {
    grade: '5',
    severity: 'Sehr schwer',
    description: 'Schwerwiegender Vertrauensbruch.',
    typicalConsequence: 'Entlassung',
    regularLevels: ['06'],
    repeatConsequence: 'Einzelfallprüfung; regelmäßig keine weitere Verwendung',
  },
  '6': {
    grade: '6',
    severity: 'Schwerstverstoß',
    description: 'Weitere Tätigkeit grundsätzlich nicht vertretbar.',
    typicalConsequence: 'Sofortige Entlassung',
    regularLevels: ['07'],
    repeatConsequence: 'Vorherige Verwarnung nicht erforderlich',
  },
}

/** Penal Grades in aufsteigender Schwere. */
export const PENAL_GRADE_ORDER: PenalGrade[] = ['1', '2', '3', '4', '5', '6']

// ---------------------------------------------------------------------------
// 03 — Verstöße nach Schwere
// ---------------------------------------------------------------------------

export const SANCTION_VIOLATIONS: SanctionViolation[] = [
  // Penal Grade 1
  { code: 'pg1.uniform', grade: '1', label: 'Uniform unvollständig' },
  { code: 'pg1.unpuenktlichkeit', grade: '1', label: 'Unpünktlichkeit ohne triftigen Grund' },
  { code: 'pg1.ablauf', grade: '1', label: 'Kleinere interne Ablaufverstöße' },
  { code: 'pg1.kommunikation', grade: '1', label: 'Unzureichende Kommunikation' },
  { code: 'pg1.dienstpflicht', grade: '1', label: 'Kleinere vergessene Dienstpflichten' },

  // Penal Grade 2
  { code: 'pg2.unpuenktlichkeit', grade: '2', label: 'Wiederholte Unpünktlichkeit' },
  { code: 'pg2.anweisungen', grade: '2', label: 'Missachtung interner Anweisungen' },
  { code: 'pg2.auftreten', grade: '2', label: 'Unprofessionelles Auftreten' },
  { code: 'pg2.kommunikation', grade: '2', label: 'Unangemessene Kommunikation' },
  { code: 'pg2.fernbleiben', grade: '2', label: 'Unbegründetes Fernbleiben' },
  { code: 'pg2.dienstweg', grade: '2', label: 'Missachtung des Dienstweges' },
  { code: 'pg2.ressourcen', grade: '2', label: 'Unsachgemäße Ressourcennutzung' },

  // Penal Grade 3
  { code: 'pg3.anweisungen', grade: '3', label: 'Wiederholte Anweisungsverstöße' },
  { code: 'pg3.dienstweg', grade: '3', label: 'Bewusste Umgehung des Dienstweges' },
  { code: 'pg3.ausruestung', grade: '3', label: 'Unbefugte Nutzung von Fahrzeugen oder Ausrüstung' },
  { code: 'pg3.respektlosigkeit', grade: '3', label: 'Respektlosigkeit gegenüber Vorgesetzten' },
  { code: 'pg3.weisungen', grade: '3', label: 'Missachtung rechtmäßiger Weisungen' },
  { code: 'pg3.einsatz-verlassen', grade: '3', label: 'Unbegründetes Verlassen eines Einsatzes' },
  { code: 'pg3.einsatz-behinderung', grade: '3', label: 'Behinderung eines Einsatzes' },

  // Penal Grade 4
  { code: 'pg4.anweisungen', grade: '4', label: 'Schwerwiegende Anweisungsverstöße' },
  { code: 'pg4.machtmissbrauch', grade: '4', label: 'Machtmissbrauch' },
  { code: 'pg4.informationsweitergabe', grade: '4', label: 'Unbefugte Weitergabe interner Informationen' },
  { code: 'pg4.unterlagen', grade: '4', label: 'Manipulation von Einsatz- oder Ermittlungsunterlagen' },
  { code: 'pg4.datenzugriff', grade: '4', label: 'Unbefugter Datenzugriff' },
  { code: 'pg4.gefaehrdung', grade: '4', label: 'Gefährdung anderer durch grobe Pflichtverletzung' },
  { code: 'pg4.einsatz-behinderung', grade: '4', label: 'Bewusste Einsatzbehinderung' },

  // Penal Grade 5
  { code: 'pg5.korruption', grade: '5', label: 'Korruption' },
  { code: 'pg5.bestechlichkeit', grade: '5', label: 'Bestechlichkeit' },
  { code: 'pg5.machtmissbrauch', grade: '5', label: 'Schwerer Machtmissbrauch' },
  { code: 'pg5.ermittlungsinfos', grade: '5', label: 'Weitergabe vertraulicher Ermittlungsinformationen' },
  { code: 'pg5.beweismittel', grade: '5', label: 'Beweismittelmanipulation' },
  { code: 'pg5.urkundenfaelschung', grade: '5', label: 'Fälschung offizieller Dokumente' },
  { code: 'pg5.verschwiegenheit', grade: '5', label: 'Schwere Verschwiegenheitsverletzung' },
  { code: 'pg5.straftaten-decken', grade: '5', label: 'Decken schwerer Straftaten' },
  { code: 'pg5.amtsmissbrauch', grade: '5', label: 'Amtsmissbrauch zum persönlichen Vorteil' },

  // Penal Grade 6
  { code: 'pg6.korruption', grade: '6', label: 'Schwere Korruption' },
  { code: 'pg6.verrat', grade: '6', label: 'Verrat hochsensibler Informationen' },
  { code: 'pg6.sabotage', grade: '6', label: 'Gezielte Sabotage des FIB' },
  { code: 'pg6.amtsmissbrauch', grade: '6', label: 'Vorsätzlicher schwerwiegender Amtsmissbrauch' },
  { code: 'pg6.organisierte-kriminalitaet', grade: '6', label: 'Schwere Zusammenarbeit mit kriminellen Organisationen' },
  { code: 'pg6.gefaehrdung', grade: '6', label: 'Vorsätzliche erhebliche Gefährdung anderer aus persönlichen Interessen' },
]

const VIOLATIONS_BY_CODE = new Map(SANCTION_VIOLATIONS.map((item) => [item.code, item]))

export function violationsForGrade(grade: PenalGrade) {
  return SANCTION_VIOLATIONS.filter((item) => item.grade === grade)
}

export function resolveViolation(code: string | null | undefined) {
  if (!code) return null
  return VIOLATIONS_BY_CODE.get(code) ?? null
}

// ---------------------------------------------------------------------------
// 04 — Wiederholungsfälle
// ---------------------------------------------------------------------------

export interface RepeatRule {
  /** Anzahl gleichartiger Verstöße inklusive des aktuellen. */
  occurrence: number
  principle: string
}

export const REPEAT_RULES: RepeatRule[] = [
  { occurrence: 1, principle: 'Regelsanktion nach Penal Grade' },
  { occurrence: 2, principle: 'Nächsthöhere Sanktionsstufe' },
  { occurrence: 3, principle: 'Degradierung oder Suspendierung' },
  { occurrence: 4, principle: 'Entlassung kann ausgesprochen werden' },
]

export const MITIGATING_CIRCUMSTANCES: string[] = [
  'Erstverstoß',
  'Fahrlässigkeit statt Vorsatz',
  'Geringe Auswirkungen',
  'Sofortige Kooperation',
  'Freiwillige Meldung',
  'Erkennbare Einsicht',
]

export const AGGRAVATING_CIRCUMSTANCES: string[] = [
  'Vorsatz',
  'Wiederholung',
  'Vertuschung',
  'Lügen im Verfahren',
  'Ausnutzung der Position',
  'Gefährdung anderer',
  'Erheblicher Schaden',
  'Missbrauch dienstlicher Ressourcen',
]

// ---------------------------------------------------------------------------
// 06 — Disziplinarverfahren
// ---------------------------------------------------------------------------

export const PROCEDURE_STEPS: { step: number; title: string; detail: string }[] = [
  { step: 1, title: 'Vorwurf', detail: 'Sachverhalt aufnehmen' },
  { step: 2, title: 'Beweise', detail: 'Beweismittel sichern' },
  { step: 3, title: 'Stellungnahme', detail: 'Betroffenen anhören' },
  { step: 4, title: 'Prüfung', detail: 'Sachverhalt unabhängig bewerten' },
  { step: 5, title: 'Einstufung', detail: 'Penal Grade festlegen' },
  { step: 6, title: 'Entscheidung', detail: 'Sanktion aussprechen' },
  { step: 7, title: 'Dokumentation', detail: 'Entscheidung festhalten' },
]

/** Ab diesem Grade soll eine zweite Führungskraft die Entscheidung bestätigen. */
export const DUAL_CONTROL_FROM_GRADE: PenalGrade = '5'

// ---------------------------------------------------------------------------
// 07 — Entscheidungs-Check
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  key: string
  label: string
}

export const DECISION_CHECKLIST: ChecklistItem[] = [
  { key: 'facts', label: 'Sachverhalt ausreichend geklärt?' },
  { key: 'evidence', label: 'Beweise / Aussagen dokumentiert?' },
  { key: 'statement', label: 'Betroffener konnte Stellung nehmen?' },
  { key: 'grade', label: 'Penal Grade anhand der Schwere bestimmt?' },
  { key: 'repeat', label: 'Wiederholungsfall geprüft?' },
  { key: 'circumstances', label: 'Mildernde / erschwerende Umstände berücksichtigt?' },
  { key: 'authority', label: 'Zuständige Stelle entscheidet?' },
  { key: 'proportionality', label: 'Sanktion verhältnismäßig?' },
  { key: 'documentation', label: 'Entscheidung dokumentiert und Betroffener informiert?' },
]

export const CHECKLIST_KEYS: ReadonlySet<string> = new Set(DECISION_CHECKLIST.map((item) => item.key))

export const CATALOG_PRINCIPLE =
  'Nicht die Person entscheidet über die Sanktion — sondern der nachgewiesene Verstoß, seine Schwere und die Umstände des Einzelfalls.'

export const CATALOG_VERSION = 'Version 1.0 — Interner FIB-Dienststandard'

// ---------------------------------------------------------------------------
// Auflösung & Validierung
// ---------------------------------------------------------------------------

export const PENAL_GRADES: ReadonlySet<string> = new Set(PENAL_GRADE_ORDER)
export const SANCTION_LEVEL_SET: ReadonlySet<string> = new Set(SANCTION_LEVEL_ORDER)

export function isPenalGrade(value: unknown): value is PenalGrade {
  return typeof value === 'string' && PENAL_GRADES.has(value)
}

export function isSanctionLevel(value: unknown): value is SanctionLevel {
  return typeof value === 'string' && SANCTION_LEVEL_SET.has(value)
}

export function resolvePenalGrade(value: string) {
  return isPenalGrade(value) ? PENAL_GRADE_RULES[value] : null
}

export function resolveSanctionLevel(value: string) {
  return isSanctionLevel(value) ? SANCTION_LEVELS[value] : null
}

export function penalGradeLabel(value: string) {
  const rule = resolvePenalGrade(value)
  return rule ? `Penal Grade ${rule.grade} — ${rule.severity}` : 'Ungültiger Penal Grade'
}

export function sanctionLevelLabel(value: string) {
  const rule = resolveSanctionLevel(value)
  return rule ? `Stufe ${rule.level} — ${rule.measure}` : 'Ungültige Sanktionsstufe'
}

export function sanctionMeasureLabel(value: string) {
  return resolveSanctionLevel(value)?.measure ?? '—'
}

/** Regelsanktion eines Grades — bei mehreren die mildere Stufe. */
export function regularLevelForGrade(grade: PenalGrade): SanctionLevel {
  return PENAL_GRADE_RULES[grade].regularLevels[0]
}

/** Nächsthöhere Sanktionsstufe; die höchste Stufe bleibt sich selbst. */
export function nextLevel(level: SanctionLevel): SanctionLevel {
  const index = SANCTION_LEVEL_ORDER.indexOf(level)
  return SANCTION_LEVEL_ORDER[Math.min(index + 1, SANCTION_LEVEL_ORDER.length - 1)]
}

/**
 * Empfohlene Stufe nach Abschnitt 04. `occurrence` zählt den aktuellen Verstoß
 * mit: 1 = Erstverstoß, 2 = erster gleichartiger Wiederholungsfall, …
 */
export function recommendedLevel(grade: PenalGrade, occurrence: number): SanctionLevel {
  const regular = regularLevelForGrade(grade)
  if (occurrence <= 1) return regular

  // Ab Penal Grade 5 ist die Regelsanktion bereits Entlassung — eine Steigerung
  // über die Stufe des Grades hinaus ergibt nur noch bei Grade 5 Sinn.
  if (occurrence === 2) return nextLevel(regular)

  const escalated = occurrence === 3 ? '04' : '06'
  const higher = SANCTION_LEVEL_ORDER.indexOf(escalated as SanctionLevel) > SANCTION_LEVEL_ORDER.indexOf(regular)
  return higher ? (escalated as SanctionLevel) : nextLevel(regular)
}

export function repeatPrinciple(occurrence: number) {
  const capped = Math.min(Math.max(occurrence, 1), REPEAT_RULES.length)
  return REPEAT_RULES[capped - 1].principle
}

/** Zuständige Stelle für eine Stufe — Grade 5/6 heben stets auf Chief-Ebene. */
export function authorityForSanction(grade: PenalGrade, level: SanctionLevel): SanctionAuthorityRule {
  if (grade === '5' || grade === '6') return SANCTION_AUTHORITIES.CHIEF_LEVEL
  return SANCTION_AUTHORITIES[SANCTION_LEVELS[level].authority]
}

export function requiresDualControl(grade: string) {
  return grade === '5' || grade === '6'
}

/** Prüft, ob eine Checklisten-Antwortmenge alle Punkte bestätigt. */
export function isChecklistComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return DECISION_CHECKLIST.every((item) => record[item.key] === true)
}

export function normalizeChecklist(value: unknown): Record<string, boolean> {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const result: Record<string, boolean> = {}
  for (const item of DECISION_CHECKLIST) {
    result[item.key] = record[item.key] === true
  }
  return result
}

/** Filtert eine Liste auf bekannte Umstände aus Abschnitt 04. */
export function normalizeCircumstances(value: unknown, allowed: string[]): string[] {
  if (!Array.isArray(value)) return []
  const set = new Set(allowed)
  return value.filter((item): item is string => typeof item === 'string' && set.has(item))
}
