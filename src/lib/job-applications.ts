import type { Prisma } from '@/generated/prisma/client'

export const APPLICATION_QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'SCALE',
] as const

export const APPLICATION_AUTOFILL_VALUES = ['DISCORD_ID'] as const

export const DEFAULT_APPLICATION_FORM_TITLE = 'FIB Bewerbung'
export const APPLICATION_FORM_TITLE = DEFAULT_APPLICATION_FORM_TITLE
export const APPLICATION_DEFAULT_STATUS_TEXT = 'Bewerbung eingereicht'
export const APPLICATION_FORM_SETTINGS_KEY = 'jobApplications.formConfig'
export const JOB_APPLICATION_STATUSES = [
  'SUBMITTED',
  'IN_REVIEW',
  'HR_INTERVIEW',
  'ACCEPTED',
  'REJECTED',
] as const

export type ApplicationQuestionType = (typeof APPLICATION_QUESTION_TYPES)[number]
export type ApplicationAutoFillValue = (typeof APPLICATION_AUTOFILL_VALUES)[number]
export type JobApplicationStatusValue = (typeof JOB_APPLICATION_STATUSES)[number]

export const JOB_APPLICATION_STATUS_META: Record<
  JobApplicationStatusValue,
  {
    label: string
    shortLabel: string
    defaultText: string
    variant: 'default' | 'success' | 'warning' | 'danger' | 'info'
  }
> = {
  SUBMITTED: {
    label: 'Eingereicht',
    shortLabel: 'Neu',
    defaultText: APPLICATION_DEFAULT_STATUS_TEXT,
    variant: 'info',
  },
  IN_REVIEW: {
    label: 'In Prüfung',
    shortLabel: 'Prüfung',
    defaultText: 'Bewerbung wird geprüft',
    variant: 'warning',
  },
  HR_INTERVIEW: {
    label: 'Gespräch mit HR',
    shortLabel: 'Gespräch',
    defaultText: 'Bewerbung ist in einem Gespräch mit HR',
    variant: 'warning',
  },
  ACCEPTED: {
    label: 'Angenommen',
    shortLabel: 'Angenommen',
    defaultText: 'Bewerbung angenommen',
    variant: 'success',
  },
  REJECTED: {
    label: 'Abgelehnt',
    shortLabel: 'Abgelehnt',
    defaultText: 'Bewerbung abgelehnt',
    variant: 'danger',
  },
}

export interface ApplicationQuestionOptions {
  choices?: string[]
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
  autoFill?: ApplicationAutoFillValue
  readOnly?: boolean
}

export interface ApplicationQuestion {
  id: string
  type: ApplicationQuestionType
  section?: string | null
  title: string
  description?: string | null
  required: boolean
  options?: ApplicationQuestionOptions | null
  sortOrder: number
}

export interface ApplicationFormConfig {
  title: string
  questions: ApplicationQuestion[]
}

const REQUIRED_LONG_TEXT = {
  type: 'LONG_TEXT' as const,
  required: true,
}

export const DEFAULT_APPLICATION_QUESTIONS: ApplicationQuestion[] = [
  {
    id: 'vollstaendiger_name_ic',
    section: 'Name & Vorname',
    title: '1.1. Vollständiger Name (IC)',
    type: 'SHORT_TEXT',
    required: true,
    sortOrder: 0,
  },
  {
    id: 'geburtsort_ic',
    section: 'Name & Vorname',
    title: '1.2. Geburtsort (IC)',
    type: 'SHORT_TEXT',
    required: true,
    sortOrder: 1,
  },
  {
    id: 'geburtsdatum_ic',
    section: 'Name & Vorname',
    title: '1.3. Geburtsdatum (IC)',
    type: 'SHORT_TEXT',
    required: true,
    sortOrder: 2,
  },
  {
    id: 'alter_ooc',
    section: 'Name & Vorname',
    title: '1.4. Alter (OOC)',
    type: 'SHORT_TEXT',
    required: true,
    sortOrder: 3,
  },
  {
    id: 'visum',
    section: 'Name & Vorname',
    title: '1.5. Visum',
    type: 'SINGLE_CHOICE',
    required: true,
    options: {
      choices: ['unter Visum 5', 'Visum 0', 'unter Visum 9', 'Über Visum 10'],
    },
    sortOrder: 4,
  },
  {
    id: 'discord_id',
    section: 'Name & Vorname',
    title: '1.6. Discord ID',
    description: 'Wird automatisch über deinen Discord-Login ermittelt.',
    type: 'SHORT_TEXT',
    required: true,
    options: {
      autoFill: 'DISCORD_ID',
      readOnly: true,
    },
    sortOrder: 5,
  },
  {
    id: 'waffenschein',
    section: 'Allgemeine Informationen',
    title: '2.1. Besitzt du einen gültigen Waffenschein?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: {
      choices: ['Ja', 'Nein', 'Keine Angabe'],
    },
    sortOrder: 6,
  },
  {
    id: 'vorstrafen',
    section: 'Allgemeine Informationen',
    title: '2.2.1. Haben Sie Vorstrafen?',
    type: 'SINGLE_CHOICE',
    required: true,
    options: {
      choices: ['Nein', 'Ja'],
    },
    sortOrder: 7,
  },
  {
    id: 'vorstrafen_details',
    section: 'Allgemeine Informationen',
    title: '2.2.2. Vorstrafen',
    description: 'Keine Pflicht, wenn du bei Vorstrafen „Nein“ ausgewählt hast.',
    type: 'LONG_TEXT',
    required: false,
    sortOrder: 8,
  },
  {
    id: 'fuehrerschein',
    section: 'Allgemeine Informationen',
    title: '2.3. Haben Sie einen Führerschein?',
    type: 'MULTIPLE_CHOICE',
    required: true,
    options: {
      choices: ['PKW', 'LKW', 'Kein Führerschein', 'Bike'],
    },
    sortOrder: 9,
  },
  {
    id: 'staatsfraktion_mitglied',
    section: 'Allgemeine Informationen',
    title: '2.4. Warst du bereits Mitglied einer Staatsfraktion?',
    type: 'LONG_TEXT',
    required: false,
    sortOrder: 10,
  },
  {
    id: 'staatsfraktion_entlassen',
    section: 'Allgemeine Informationen',
    title: '2.5. Wurdest du bereits aus einer Staatsfraktion entlassen und warum?',
    type: 'LONG_TEXT',
    required: false,
    sortOrder: 11,
  },
  {
    id: 'motivation_fib',
    section: 'Deine Motivation',
    title: '3.1. Warum möchtest du Mitglied des FIB werden?',
    sortOrder: 12,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'warum_einstellen',
    section: 'Deine Motivation',
    title: '3.2. Warum sollten wir genau dich einstellen?',
    sortOrder: 13,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'teamarbeit',
    section: 'Deine Motivation',
    title: '3.3. Was bedeutet für dich Teamarbeit?',
    sortOrder: 14,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'erwartung_fib',
    section: 'Deine Motivation',
    title: '3.4. Was erwartest du vom FIB?',
    sortOrder: 15,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'zukunft_department',
    section: 'Deine Motivation',
    title: '3.5. Wo siehst du dich in einigen Wochen innerhalb des Departments?',
    sortOrder: 16,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'staerken',
    section: 'Persönlichkeit',
    title: '4.1. Nenne mindestens fünf deiner Stärken.',
    sortOrder: 17,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'schwaechen',
    section: 'Persönlichkeit',
    title: '4.2. Nenne mindestens drei deiner Schwächen.',
    sortOrder: 18,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'kritik',
    section: 'Persönlichkeit',
    title: '4.3. Wie gehst du mit Kritik um?',
    sortOrder: 19,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'stress',
    section: 'Persönlichkeit',
    title: '4.4. Wie reagierst du unter Stress?',
    sortOrder: 20,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'guter_polizeibeamter',
    section: 'Persönlichkeit',
    title: '4.5. Welche Eigenschaften sollte ein guter Polizeibeamter besitzen?',
    sortOrder: 21,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'schlechter_polizeibeamter',
    section: 'Persönlichkeit',
    title: '4.6. Was macht einen schlechten Polizeibeamten aus?',
    sortOrder: 22,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'ausweis_verweigert',
    section: 'Situationsfragen',
    title: '5.1. Ein Bürger weigert sich, seinen Ausweis vorzuzeigen. Wie gehst du vor?',
    sortOrder: 23,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'verkehrskontrolle_flucht',
    section: 'Situationsfragen',
    title: '5.2. Während einer Verkehrskontrolle flüchtet der Fahrer. Wie reagierst du?',
    sortOrder: 24,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'schusswechsel_erstmassnahmen',
    section: 'Situationsfragen',
    title: '5.3. Du bist als Erster an einem Schusswechsel. Was sind deine ersten Maßnahmen?',
    sortOrder: 25,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'kollege_verstoss',
    section: 'Situationsfragen',
    title: '5.4. Ein Kollege verstößt gegen die Dienstordnung. Wie handelst du?',
    sortOrder: 26,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'zwei_einsaetze',
    section: 'Situationsfragen',
    title: '5.5. Du erhältst zwei Einsätze gleichzeitig. Wie entscheidest du, welchen du zuerst bearbeitest?',
    type: 'LONG_TEXT',
    required: false,
    sortOrder: 27,
  },
  {
    id: 'familie_oder_beruf',
    section: 'End Fragen',
    title: '6.1. Was ist wichtiger: Familie oder Beruf?',
    sortOrder: 28,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'aktive_tage',
    section: 'End Fragen',
    title: '6.2. An welchen Tagen sind Sie aktiv?',
    sortOrder: 29,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'quelle_fib',
    section: 'End Fragen',
    title: '6.3. Wie hast du vom FIB erfahren?',
    sortOrder: 30,
    ...REQUIRED_LONG_TEXT,
  },
  {
    id: 'zusatzbewerbung_einverstanden',
    section: 'End Fragen',
    title:
      'Wenn uns die Antworten nicht ausreichen, bist du einverstanden, zusätzlich eine Bewerbung zu schicken?',
    description:
      'Bei „Nein“ wird die Bewerbung als Hauptbewerbung gezählt.',
    type: 'SINGLE_CHOICE',
    required: true,
    options: {
      choices: ['Ja', 'Nein'],
    },
    sortOrder: 31,
  },
  {
    id: 'selbsteinschaetzung',
    section: 'Schlusswort',
    title: 'Wie schätzt du deine Bewerbung ein?',
    type: 'SCALE',
    required: true,
    options: {
      min: 1,
      max: 10,
    },
    sortOrder: 32,
  },
]

export const DEFAULT_APPLICATION_FORM_CONFIG: ApplicationFormConfig = {
  title: DEFAULT_APPLICATION_FORM_TITLE,
  questions: DEFAULT_APPLICATION_QUESTIONS,
}

interface NormalizedAnswer {
  questionId: string
  questionTitle: string
  questionType: ApplicationQuestionType
  type: ApplicationQuestionType
  value: Prisma.InputJsonValue
  textValue: string
  sortOrder: number
}

interface ApplicationAnswerContext {
  discordId?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanApplicationText(value: unknown, maxLength = 2000) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function cleanApplicationLongText(value: unknown, maxLength = 8000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function cleanApplicationStatusText(value: unknown, fallback: string) {
  const text = cleanApplicationLongText(value, 1000)
    .replace(/\s+/g, ' ')
    .trim()

  return text || fallback
}

export function isJobApplicationStatus(
  value: unknown,
): value is JobApplicationStatusValue {
  return JOB_APPLICATION_STATUSES.includes(value as JobApplicationStatusValue)
}

function slugifyQuestionId(value: string, fallback: string) {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)

  return slug || fallback
}

function readOptions(value: unknown): ApplicationQuestionOptions {
  if (!isRecord(value)) return {}

  const choices = Array.isArray(value.choices)
    ? value.choices
        .map((choice) => cleanApplicationText(choice, 120))
        .filter(Boolean)
        .slice(0, 20)
    : undefined

  const min = Number(value.min)
  const max = Number(value.max)
  const autoFill = value.autoFill === 'DISCORD_ID' ? 'DISCORD_ID' : undefined

  return {
    choices,
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    minLabel: cleanApplicationText(value.minLabel, 80) || undefined,
    maxLabel: cleanApplicationText(value.maxLabel, 80) || undefined,
    autoFill,
    readOnly: autoFill ? true : value.readOnly === true,
  }
}

function normalizeQuestionOptions(
  questionType: ApplicationQuestionType,
  options: unknown,
) {
  const cleanOptions = readOptions(options)
  const normalized: ApplicationQuestionOptions = {}

  if (questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') {
    normalized.choices = cleanOptions.choices?.length
      ? cleanOptions.choices
      : ['Ja', 'Nein']
  }

  if (questionType === 'SCALE') {
    const rawMin = cleanOptions.min ?? 1
    const rawMax = cleanOptions.max ?? 10
    const min = Math.max(0, Math.min(100, rawMin))
    const max = Math.max(min + 1, Math.min(100, rawMax))
    normalized.min = min
    normalized.max = max
    normalized.minLabel = cleanOptions.minLabel
    normalized.maxLabel = cleanOptions.maxLabel
  }

  if (cleanOptions.autoFill) {
    normalized.autoFill = cleanOptions.autoFill
    normalized.readOnly = true
  } else if (cleanOptions.readOnly) {
    normalized.readOnly = true
  }

  return Object.keys(normalized).length ? normalized : null
}

function normalizeApplicationQuestion(
  rawQuestion: unknown,
  index: number,
): ApplicationQuestion | null {
  if (!isRecord(rawQuestion)) return null

  const title = cleanApplicationText(rawQuestion.title, 240)
  if (!title) return null

  const type = APPLICATION_QUESTION_TYPES.includes(
    rawQuestion.type as ApplicationQuestionType,
  )
    ? (rawQuestion.type as ApplicationQuestionType)
    : 'LONG_TEXT'

  const id = slugifyQuestionId(
    cleanApplicationText(rawQuestion.id, 100) || title,
    `frage_${index + 1}`,
  )

  return {
    id,
    type,
    section: cleanApplicationText(rawQuestion.section, 120) || null,
    title,
    description: cleanApplicationText(rawQuestion.description, 500) || null,
    required: rawQuestion.required !== false,
    options: normalizeQuestionOptions(type, rawQuestion.options),
    sortOrder: Number.isFinite(Number(rawQuestion.sortOrder))
      ? Number(rawQuestion.sortOrder)
      : index,
  } satisfies ApplicationQuestion
}

function withUniqueQuestionIds(questions: ApplicationQuestion[]) {
  const seen = new Map<string, number>()

  return questions.map((question, index) => {
    const cleanId = slugifyQuestionId(question.id, `frage_${index + 1}`)
    const count = seen.get(cleanId) ?? 0
    seen.set(cleanId, count + 1)

    return {
      ...question,
      id: count > 0 ? `${cleanId}_${count + 1}` : cleanId,
      sortOrder: index,
    }
  })
}

export function normalizeApplicationFormConfig(
  rawConfig: unknown,
): ApplicationFormConfig {
  if (!isRecord(rawConfig)) return DEFAULT_APPLICATION_FORM_CONFIG

  const title =
    cleanApplicationText(rawConfig.title, 120) || DEFAULT_APPLICATION_FORM_TITLE
  const rawQuestions = Array.isArray(rawConfig.questions)
    ? rawConfig.questions
    : []
  const questions = rawQuestions
    .map((question, index) => normalizeApplicationQuestion(question, index))
    .filter((question): question is ApplicationQuestion => Boolean(question))
    .sort((first, second) => first.sortOrder - second.sortOrder)

  return {
    title,
    questions: questions.length
      ? withUniqueQuestionIds(questions)
      : DEFAULT_APPLICATION_QUESTIONS,
  }
}

export function getApplicationChoiceOptions(question: ApplicationQuestion) {
  return question.options?.choices?.length
    ? question.options.choices
    : ['Ja', 'Nein']
}

export function getApplicationScaleOptions(question: ApplicationQuestion) {
  const min = Number.isFinite(question.options?.min) ? question.options!.min! : 1
  const max = Number.isFinite(question.options?.max)
    ? question.options!.max!
    : 10

  return {
    min,
    max: Math.max(max, min),
    minLabel: question.options?.minLabel,
    maxLabel: question.options?.maxLabel,
  }
}

function normalizeAnswerValue(
  question: ApplicationQuestion,
  rawValue: unknown,
): { value: Prisma.InputJsonValue; textValue: string } {
  if (question.type === 'MULTIPLE_CHOICE') {
    const allowed = new Set(getApplicationChoiceOptions(question))
    const values = Array.isArray(rawValue)
      ? rawValue
          .map((value) => cleanApplicationText(value, 120))
          .filter((value) => value && allowed.has(value))
      : []
    const uniqueValues = Array.from(new Set(values))

    return {
      value: uniqueValues,
      textValue: uniqueValues.join(', '),
    }
  }

  if (question.type === 'SINGLE_CHOICE') {
    const value = cleanApplicationText(rawValue, 120)
    const allowed = new Set(getApplicationChoiceOptions(question))
    const normalized = allowed.has(value) ? value : ''

    return {
      value: normalized,
      textValue: normalized,
    }
  }

  if (question.type === 'SCALE') {
    const { min, max } = getApplicationScaleOptions(question)
    const numericValue = Number(rawValue)
    const value =
      Number.isFinite(numericValue) &&
      numericValue >= min &&
      numericValue <= max
        ? numericValue
        : ''

    return {
      value,
      textValue: value === '' ? '' : String(value),
    }
  }

  if (question.type === 'SHORT_TEXT') {
    const value = cleanApplicationText(rawValue, 500)
    return {
      value,
      textValue: value,
    }
  }

  const value = cleanApplicationLongText(rawValue)
  return {
    value,
    textValue: value,
  }
}

function resolveRawAnswerValue(
  question: ApplicationQuestion,
  rawAnswers: Record<string, unknown>,
  context?: ApplicationAnswerContext,
) {
  if (question.options?.autoFill === 'DISCORD_ID') {
    return context?.discordId ?? ''
  }

  return rawAnswers[question.id]
}

export function normalizeApplicationAnswers(
  rawAnswers: unknown,
  questions: ApplicationQuestion[],
  context?: ApplicationAnswerContext,
) {
  const answerInput = isRecord(rawAnswers) ? rawAnswers : {}
  const normalized: NormalizedAnswer[] = []
  const errors: string[] = []

  questions.forEach((question) => {
    const rawValue = resolveRawAnswerValue(question, answerInput, context)
    const answer = normalizeAnswerValue(question, rawValue)
    const isEmpty =
      answer.textValue.trim().length === 0 ||
      (Array.isArray(answer.value) && answer.value.length === 0)

    if (question.required && isEmpty) {
      errors.push(`${question.title} ist erforderlich.`)
    }

    normalized.push({
      questionId: question.id,
      questionTitle: question.title,
      questionType: question.type,
      type: question.type,
      value: answer.value,
      textValue: answer.textValue,
      sortOrder: question.sortOrder,
    })
  })

  return { normalized, errors }
}

/** Standard-Frage, aus der der IC-Name des Bewerbers stammt. */
export const APPLICANT_NAME_QUESTION_ID = 'vollstaendiger_name_ic'

interface AnswerForName {
  questionId: string
  questionTitle?: string | null
  textValue?: string | null
  value?: unknown
}

function looksLikeNameQuestion(answer: AnswerForName) {
  const haystack = `${answer.questionId} ${answer.questionTitle ?? ''}`.toLowerCase()
  if (haystack.includes('discord') || haystack.includes('username')) return false
  return haystack.includes('name')
}

/**
 * Liest den IC-Namen aus den Bewerbungsantworten. Das Formular ist frei
 * konfigurierbar, deshalb wird nach der Standard-Frage-ID gesucht und erst
 * danach auf „irgendeine Namensfrage“ zurückgefallen.
 */
export function pickApplicantName(answers: AnswerForName[]) {
  const candidates = [
    answers.find((answer) => answer.questionId === APPLICANT_NAME_QUESTION_ID),
    ...answers.filter(looksLikeNameQuestion),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const text = applicationAnswerText(candidate).replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, 80)
  }

  return ''
}

export function applicationAnswerText(answer: {
  textValue?: string | null
  value?: unknown
}) {
  if (answer.textValue) return answer.textValue
  const { value } = answer

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(entry)))
      .join(', ')
  }

  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}
