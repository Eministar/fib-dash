// Bewusst ohne Node-Imports: diese Datei wird auch von Client-Komponenten
// genutzt (Status-Labels, Feldtypen, Validierung der Eingaben im Formular).
// Die Token-Erzeugung liegt deshalb in `contract-service.ts`.

export const CONTRACT_STATUSES = ['DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'CANCELLED'] as const
export type ContractStatusValue = (typeof CONTRACT_STATUSES)[number]

export const CONTRACT_FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'DATE',
  'CHECKBOX',
  'SIGNATURE',
] as const
export type ContractFieldTypeValue = (typeof CONTRACT_FIELD_TYPES)[number]

export const CONTRACT_STATUS_META: Record<
  ContractStatusValue,
  { label: string; shortLabel: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  DRAFT: { label: 'Entwurf', shortLabel: 'Entwurf', variant: 'default' },
  SENT: { label: 'Versendet – wartet auf Unterschrift', shortLabel: 'Offen', variant: 'warning' },
  SIGNED: { label: 'Unterschrieben', shortLabel: 'Unterschrieben', variant: 'success' },
  DECLINED: { label: 'Abgelehnt', shortLabel: 'Abgelehnt', variant: 'danger' },
  CANCELLED: { label: 'Zurückgezogen', shortLabel: 'Zurückgezogen', variant: 'default' },
}

export const CONTRACT_FIELD_TYPE_LABELS: Record<ContractFieldTypeValue, string> = {
  SHORT_TEXT: 'Kurzes Textfeld',
  LONG_TEXT: 'Mehrzeiliges Textfeld',
  DATE: 'Datum',
  CHECKBOX: 'Bestätigung (Häkchen)',
  SIGNATURE: 'Unterschrift',
}

export interface ContractField {
  id: string
  type: ContractFieldTypeValue
  label: string
  description?: string | null
  placeholder?: string | null
  required: boolean
  sortOrder: number
}

/** Eine einzelne Regelung im Vertrag — wird als „§ n Titel“ gesetzt. */
export interface ContractClause {
  id: string
  title: string
  body: string
  sortOrder: number
}

/** Ausstellungsort auf jedem Vertrag — bewusst fest, nicht konfigurierbar. */
export const CONTRACT_PLACE = 'Nerowood'

/** Werte, die der Unterzeichner einträgt. Checkbox → boolean, sonst Text. */
export type ContractValues = Record<string, string | boolean>

export { normalizeLinkToken } from '@/lib/link-tokens'

export function isContractStatus(value: unknown): value is ContractStatusValue {
  return typeof value === 'string' && (CONTRACT_STATUSES as readonly string[]).includes(value)
}

function isContractFieldType(value: unknown): value is ContractFieldTypeValue {
  return typeof value === 'string' && (CONTRACT_FIELD_TYPES as readonly string[]).includes(value)
}

export function cleanContractText(value: unknown, maxLength = 191) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function cleanContractLongText(value: unknown, maxLength = 20000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function slugifyFieldId(value: string, fallback: string) {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

  return slug || fallback
}

function sanitizeContractField(raw: unknown, index: number): ContractField | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>

  const label = cleanContractText(input.label, 200)
  if (!label) return null

  const type = isContractFieldType(input.type) ? input.type : 'SHORT_TEXT'

  return {
    id: slugifyFieldId(cleanContractText(input.id, 80) || label, `feld_${index + 1}`),
    type,
    label,
    description: cleanContractText(input.description, 400) || null,
    placeholder: cleanContractText(input.placeholder, 120) || null,
    // Unterschriftsfelder sind immer Pflicht — ein Vertrag ohne Unterschrift
    // wäre sonst „unterschrieben“, ohne dass jemand unterschrieben hat.
    required: type === 'SIGNATURE' ? true : input.required !== false,
    sortOrder: index,
  }
}

export function sanitizeContractFields(value: unknown): ContractField[] {
  if (!Array.isArray(value)) return []
  const seen = new Map<string, number>()

  return value
    .map((item, index) => sanitizeContractField(item, index))
    .filter((field): field is ContractField => Boolean(field))
    .slice(0, 40)
    .map((field, index) => {
      const count = seen.get(field.id) ?? 0
      seen.set(field.id, count + 1)
      return {
        ...field,
        id: count > 0 ? `${field.id}_${count + 1}` : field.id,
        sortOrder: index,
      }
    })
}

/** Liest die in der DB als JSON abgelegten Felder zurück in typisierte Felder. */
export function readContractFields(value: unknown): ContractField[] {
  return sanitizeContractFields(value)
}

function sanitizeContractClause(raw: unknown, index: number): ContractClause | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>

  const title = cleanContractText(input.title, 200)
  const body = cleanContractLongText(input.body, 6000)
  if (!title && !body) return null

  return {
    id: slugifyFieldId(cleanContractText(input.id, 80) || title, `regelung_${index + 1}`),
    title: title || `Regelung ${index + 1}`,
    body,
    sortOrder: index,
  }
}

export function sanitizeContractClauses(value: unknown): ContractClause[] {
  if (!Array.isArray(value)) return []
  const seen = new Map<string, number>()

  return value
    .map((item, index) => sanitizeContractClause(item, index))
    .filter((clause): clause is ContractClause => Boolean(clause))
    .slice(0, 60)
    .map((clause, index) => {
      const count = seen.get(clause.id) ?? 0
      seen.set(clause.id, count + 1)
      return {
        ...clause,
        id: count > 0 ? `${clause.id}_${count + 1}` : clause.id,
        sortOrder: index,
      }
    })
}

export function readContractClauses(value: unknown): ContractClause[] {
  return sanitizeContractClauses(value)
}

export function readContractValues(value: unknown): ContractValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ContractValues = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'boolean') out[key] = raw
    else if (typeof raw === 'string') out[key] = raw
    else if (typeof raw === 'number') out[key] = String(raw)
  }
  return out
}

export interface ContractPlaceholderContext {
  firstName: string
  lastName: string
  badgeNumber: string
  rankName: string
  hireDate: Date | string | null
  discordId?: string | null
  units?: string[]
  departmentName?: string
}

export function formatContractDate(value: Date | string | null | undefined) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function replacePlaceholders(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const normalized = key.toLowerCase()
    return normalized in values ? values[normalized] : match
  })
}

/**
 * Ersetzt die Agent-Platzhalter im Vorlagentext. Läuft einmalig beim Erstellen
 * des Vertrags (Snapshot). `{{datum}}` und `{{ort}}` bleiben absichtlich stehen —
 * die werden erst beim Anzeigen aufgelöst, damit auf dem Dokument immer das
 * aktuelle Datum steht. Unbekannte Platzhalter bleiben ebenfalls sichtbar, damit
 * Tippfehler in der Vorlage auffallen statt still eine Lücke zu hinterlassen.
 */
export function renderContractContent(content: string, context: ContractPlaceholderContext) {
  const fullName = [context.firstName, context.lastName].filter(Boolean).join(' ')

  return replacePlaceholders(content, {
    vorname: context.firstName ?? '',
    nachname: context.lastName ?? '',
    name: fullName,
    dienstnummer: context.badgeNumber ?? '',
    rang: context.rankName ?? '',
    einstellungsdatum: formatContractDate(context.hireDate),
    discord_id: context.discordId ?? '',
    units: (context.units ?? []).join(', '),
    department: context.departmentName ?? 'Federal Investigation Bureau',
  })
}

/**
 * Zweite Stufe: löst Ort und Datum beim Anzeigen des Dokuments auf. Der Ort ist
 * immer {@link CONTRACT_PLACE}; das Datum ist bei einem unterschriebenen Vertrag
 * das Unterschriftsdatum, sonst der heutige Tag.
 */
export function applyContractDatePlaceholders(text: string, date: Date | string | null | undefined) {
  const resolved = date ? new Date(date) : new Date()
  return replacePlaceholders(text, {
    datum: formatContractDate(Number.isNaN(resolved.getTime()) ? new Date() : resolved),
    ort: CONTRACT_PLACE,
  })
}

export function contractPlaceholderHelp() {
  return [
    { token: '{{vorname}}', description: 'Vorname des Agents' },
    { token: '{{nachname}}', description: 'Nachname des Agents' },
    { token: '{{name}}', description: 'Vor- und Nachname' },
    { token: '{{dienstnummer}}', description: 'Dienstnummer' },
    { token: '{{rang}}', description: 'Rang bei Vertragserstellung' },
    { token: '{{einstellungsdatum}}', description: 'Einstellungsdatum' },
    { token: '{{datum}}', description: 'Immer das aktuelle Datum (bzw. Unterschriftsdatum)' },
    { token: '{{ort}}', description: `Ausstellungsort — immer „${CONTRACT_PLACE}“` },
    { token: '{{discord_id}}', description: 'Discord-ID des Agents' },
    { token: '{{units}}', description: 'Zugewiesene Units' },
    { token: '{{department}}', description: 'Name des Departments' },
  ]
}

/**
 * Prüft die Eingaben des Unterzeichners gegen die Felddefinitionen des Vertrags.
 * Gibt bereinigte Werte und Fehlermeldungen zurück.
 */
export function validateContractValues(fields: ContractField[], rawValues: unknown) {
  const input = readContractValues(rawValues)
  const values: ContractValues = {}
  const errors: string[] = []

  for (const field of fields) {
    const raw = input[field.id]

    if (field.type === 'CHECKBOX') {
      const checked = raw === true || raw === 'true'
      values[field.id] = checked
      if (field.required && !checked) errors.push(`„${field.label}“ muss bestätigt werden.`)
      continue
    }

    const maxLength = field.type === 'LONG_TEXT' ? 4000 : 200
    const text = typeof raw === 'string' ? raw.trim().slice(0, maxLength) : ''
    values[field.id] = text

    if (field.required && !text) {
      errors.push(`„${field.label}“ ist erforderlich.`)
      continue
    }

    if (field.type === 'DATE' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      errors.push(`„${field.label}“ braucht ein gültiges Datum.`)
    }

    if (field.type === 'SIGNATURE' && text && text.length < 3) {
      errors.push(`„${field.label}“ muss den vollständigen Namen enthalten.`)
    }
  }

  return { values, errors }
}

/** Das erste Unterschriftsfeld — dessen Wert wird als `signedName` gespeichert. */
export function primarySignatureField(fields: ContractField[]) {
  return fields.find((field) => field.type === 'SIGNATURE') ?? null
}

export const DEFAULT_CONTRACT_TEMPLATE_NAME = 'Arbeitsvertrag'


export const DEFAULT_CONTRACT_TEMPLATE_CONTENT = `Zwischen dem **{{department}}**, vertreten durch die Personalabteilung
(nachfolgend „Department“),

und

**{{name}}**, Discord-ID \`{{discord_id}}\`
(nachfolgend „Mitarbeiter“),

wird der folgende Arbeitsvertrag geschlossen.`

export const DEFAULT_CONTRACT_TEMPLATE_CLOSING = `**{{department}} — Official Contract — Confidential**

Ort/Datum: {{ort}}, {{datum}}

Personalabteilung
{{department}}`

export const DEFAULT_CONTRACT_TEMPLATE_CLAUSES: ContractClause[] = [
  {
    id: 'taetigkeit',
    title: 'Tätigkeit und Dienstgrad',
    body: 'Der Mitarbeiter wird zum {{einstellungsdatum}} im Dienstgrad **{{rang}}** unter der Dienstnummer **{{dienstnummer}}** in den Dienst des {{department}} aufgenommen.\n\nDer Mitarbeiter wird entsprechend seiner Position und Qualifikation innerhalb des {{department}} eingesetzt. Das Department behält sich vor, dem Mitarbeiter im Rahmen seiner Qualifikation andere zumutbare Aufgaben und Zuständigkeiten zu übertragen.\n\nDie Ausübung besonderer oder hoheitlicher Befugnisse erfolgt ausschließlich im Rahmen der geltenden Gesetze, Dienstordnungen, internen Regelungen und erteilten Zuständigkeiten.',
    sortOrder: 0,
  },
  {
    id: 'dienstpflichten',
    title: 'Dienstpflichten',
    body: 'Der Mitarbeiter verpflichtet sich, die Dienstordnung des {{department}}, geltende Sanktions- und Verfahrensregelungen sowie alle für seinen Dienstbereich geltenden Gesetze, Vorschriften und Anordnungen einzuhalten. Dienstliche Anweisungen von Vorgesetzten sind im Rahmen der geltenden Vorschriften unverzüglich zu befolgen.\n\nDer Mitarbeiter tritt seinen Dienst zuverlässig und pünktlich an und meldet Abwesenheiten rechtzeitig über die dafür vorgesehenen Wege. Der Mitarbeiter ist verpflichtet, seine dienstlichen Aufgaben gewissenhaft, unparteiisch und verantwortungsvoll wahrzunehmen.\n\nDer Mitarbeiter hat bei allen dienstlichen Tätigkeiten die ihm übertragenen Befugnisse einzuhalten und darf diese nicht eigenmächtig überschreiten. Festgestellte Pflichtverletzungen, relevante Interessenkonflikte sowie Umstände, die die ordnungsgemäße Ausübung des Dienstes beeinträchtigen können, sind unverzüglich der zuständigen Führungskraft zu melden.',
    sortOrder: 1,
  },
  {
    id: 'verschwiegenheit',
    title: 'Verschwiegenheit',
    body: 'Der Mitarbeiter verpflichtet sich, über alle dienstlichen Angelegenheiten, insbesondere über laufende Ermittlungen, interne Vorgänge, personenbezogene Daten, operative Informationen, behördeninterne Kommunikation sowie nicht öffentliche rechtliche Angelegenheiten, Stillschweigen zu bewahren.\n\nEine Weitergabe dienstlicher Informationen an unbefugte Dritte ist untersagt. Diese Pflicht besteht auch nach Beendigung des Dienstverhältnisses fort, soweit gesetzlich zulässig.',
    sortOrder: 2,
  },
  {
    id: 'ausruestung',
    title: 'Ausrüstung und dienstliche Arbeitsmittel',
    body: 'Die dem Mitarbeiter vom {{department}} überlassene Ausrüstung, Arbeitsmittel, Dienstausweise, Schlüssel, Kommunikationsmittel sowie sonstige dienstliche Gegenstände bleiben Eigentum des Departments.\n\nSie sind sorgfältig und ausschließlich im Rahmen der dienstlichen Verwendung zu behandeln. Eine Weitergabe an Dritte oder private Nutzung ist nur zulässig, soweit dies ausdrücklich gestattet wurde.\n\nBei Beendigung des Dienstverhältnisses sind sämtliche überlassenen Gegenstände unverzüglich und vollständig an das Department zurückzugeben.',
    sortOrder: 3,
  },
  {
    id: 'probezeit',
    title: 'Probezeit',
    body: 'Die Probezeit beträgt 14 Kalendertage ab Beginn des Dienstverhältnisses. Während der Probezeit kann das Dienstverhältnis von beiden Seiten jederzeit ohne Angabe von Gründen beendet werden, soweit dem keine zwingenden gesetzlichen oder sonstigen höherrangigen Regelungen entgegenstehen.',
    sortOrder: 4,
  },
  {
    id: 'beendigung',
    title: 'Beendigung des Dienstverhältnisses',
    body: 'Das Dienstverhältnis kann durch Kündigung, Aufhebungsvertrag oder auf sonstige nach den geltenden Regelungen zulässige Weise beendet werden. Mit Beendigung des Dienstverhältnisses enden grundsätzlich sämtliche dienstlichen Befugnisse und Zugriffsberechtigungen des Mitarbeiters.\n\nDie Beendigung des Dienstverhältnisses entbindet den Mitarbeiter nicht von Verpflichtungen, die bereits während seiner Dienstzeit entstanden sind. Insbesondere bleiben die Verschwiegenheitspflicht, die Pflicht zur Rückgabe dienstlichen Eigentums sowie sonstige nach ihrem Inhalt fortbestehende Verpflichtungen auch nach Beendigung des Dienstverhältnisses bestehen.',
    sortOrder: 5,
  },
  {
    id: 'offene-sanktionen',
    title: 'Offene Sanktionen und Verpflichtungen',
    body: 'Der Mitarbeiter ist verpflichtet, sämtliche gegen ihn rechtmäßig verhängten Sanktionen, Geldstrafen oder sonstigen dienstlichen Verpflichtungen fristgerecht und vollständig zu erfüllen.\n\nDie Beendigung des Dienstverhältnisses entbindet den Mitarbeiter grundsätzlich nicht von bereits entstandenen Verpflichtungen. Bereits verhängte oder vor dem Ausscheiden entstandene Sanktionen bleiben nach Maßgabe der jeweils geltenden Regelungen bestehen.\n\nDas Department behält sich vor, offene Forderungen sowie sonstige Pflichtverletzungen im Rahmen der geltenden rechtlichen und internen Möglichkeiten durchzusetzen.',
    sortOrder: 6,
  },
  {
    id: 'rechtliche-angelegenheiten',
    title: 'Rechtliche Angelegenheiten',
    body: 'Rechtliche Angelegenheiten des {{department}} werden nach Maßgabe der geltenden Zuständigkeitsregelungen durch die Legal Affairs Division (LAD) bearbeitet oder koordiniert.\n\nDer Mitarbeiter verpflichtet sich, bei rechtlich relevanten Vorgängen mit der LAD und anderen zuständigen Stellen des Departments zusammenzuarbeiten und erforderliche Informationen vollständig und wahrheitsgemäß zur Verfügung zu stellen.\n\nEine eigenständige rechtliche Vertretung des {{department}} nach außen ist nur zulässig, wenn der Mitarbeiter hierzu ausdrücklich befugt wurde.',
    sortOrder: 7,
  },
  {
    id: 'datenschutz',
    title: 'Datenschutz und Umgang mit dienstlichen Informationen',
    body: 'Der Mitarbeiter verpflichtet sich zur Einhaltung der geltenden Datenschutz- und Sicherheitsbestimmungen. Personenbezogene und sonstige vertrauliche Informationen dürfen ausschließlich im Rahmen der dienstlichen Zuständigkeit und für einen zulässigen dienstlichen Zweck verarbeitet oder weitergegeben werden.\n\nZugangsdaten, Dienstausweise und sonstige Zugangsmittel sind vor dem Zugriff Dritter zu schützen. Der Verlust dienstlicher Unterlagen, Geräte, Zugangsmittel oder vertraulicher Informationen ist unverzüglich der zuständigen Stelle zu melden.',
    sortOrder: 8,
  },
  {
    id: 'nebentaetigkeiten',
    title: 'Nebentätigkeiten und Interessenkonflikte',
    body: 'Nebentätigkeiten sind der zuständigen Stelle anzuzeigen, soweit dies nach den geltenden Regelungen erforderlich ist. Der Mitarbeiter darf keine Tätigkeit ausüben, die zu einem Interessenkonflikt mit seinen dienstlichen Aufgaben führt oder die ordnungsgemäße Ausübung seines Dienstes beeinträchtigt.\n\nPersönliche oder wirtschaftliche Interessen, die seine dienstliche Tätigkeit beeinflussen könnten, sind unverzüglich gegenüber der zuständigen Führungskraft offenzulegen.',
    sortOrder: 9,
  },
  {
    id: 'schlussbestimmungen',
    title: 'Schlussbestimmungen',
    body: 'Mündliche Nebenabreden bestehen nicht. Änderungen und Ergänzungen dieses Vertrages bedürfen der hierfür vorgesehenen Form. Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.\n\nSoweit einzelne Bestimmungen dieses Vertrages zwingenden gesetzlichen oder übergeordneten Regelungen widersprechen, gehen die höherrangigen Regelungen vor. Dieser Arbeitsvertrag wird vor seiner endgültigen Einführung mit dem Federal Justice Department (FJD) bzw. den zuständigen Stellen abgestimmt.\n\nMit seiner Unterschrift bestätigt der Mitarbeiter, diesen Vertrag vollständig gelesen, verstanden und akzeptiert zu haben.',
    sortOrder: 10,
  },
]

export const DEFAULT_CONTRACT_TEMPLATE_FIELDS: ContractField[] = [
  {
    id: 'ic_name',
    type: 'SHORT_TEXT',
    label: 'Name (IC)',
    description: 'Wie im Personalausweis eingetragen.',
    placeholder: 'Max Mustermann',
    required: true,
    sortOrder: 0,
  },
  {
    id: 'geburtsdatum',
    type: 'DATE',
    label: 'Geburtsdatum (IC)',
    description: null,
    placeholder: null,
    required: true,
    sortOrder: 1,
  },
  {
    id: 'anmerkungen',
    type: 'LONG_TEXT',
    label: 'Anmerkungen',
    description: 'Optionale Ergänzungen zum Vertrag.',
    placeholder: null,
    required: false,
    sortOrder: 2,
  },
  {
    id: 'dienstordnung_gelesen',
    type: 'CHECKBOX',
    label: 'Dienstordnung gelesen & akzeptiert.',
    description: null,
    placeholder: null,
    required: true,
    sortOrder: 3,
  },
  {
    id: 'unterschrift',
    type: 'SIGNATURE',
    label: 'Unterschrift',
    description: 'Tippe deinen vollständigen Namen — das gilt als rechtsverbindliche Unterschrift.',
    placeholder: 'Vor- und Nachname',
    required: true,
    sortOrder: 4,
  },
]
