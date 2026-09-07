import { createHash, randomBytes } from 'node:crypto'

export const FORM_TEST_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const
export type FormTestStatusValue = (typeof FORM_TEST_STATUSES)[number]

export const FORM_TEST_KINDS = ['TEST', 'SURVEY'] as const
export type FormTestKindValue = (typeof FORM_TEST_KINDS)[number]

export const FORM_QUESTION_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE'] as const
export type FormQuestionTypeValue = (typeof FORM_QUESTION_TYPES)[number]

const HASH_SECRET = process.env.JWT_SECRET || 'fallback-secret'

type QuestionOptions = {
  choices?: string[]
  correct?: string[]
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
}

export interface QuestionInput {
  id?: string
  type: FormQuestionTypeValue
  title: string
  description: string | null
  required: boolean
  options: QuestionOptions | null
  points: number
  sortOrder: number
}

export interface FormQuestionLike {
  id: string
  type: FormQuestionTypeValue | string
  title: string
  description?: string | null
  required: boolean
  options?: unknown
  points: number
  sortOrder: number
}

export interface NormalizedAnswer {
  questionId: string
  value: Record<string, unknown>
}

export function generateFormShareToken() {
  return randomBytes(18).toString('base64url')
}

export function cleanFormText(value: unknown, maxLength = 191) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function cleanLongFormText(value: unknown, maxLength = 5000) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function isFormTestStatus(value: unknown): value is FormTestStatusValue {
  return typeof value === 'string' && (FORM_TEST_STATUSES as readonly string[]).includes(value)
}

export function isFormTestKind(value: unknown): value is FormTestKindValue {
  return typeof value === 'string' && (FORM_TEST_KINDS as readonly string[]).includes(value)
}

export function isFormQuestionType(value: unknown): value is FormQuestionTypeValue {
  return typeof value === 'string' && (FORM_QUESTION_TYPES as readonly string[]).includes(value)
}

export function cleanTimeLimitMinutes(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const minutes = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(minutes)) return null
  return Math.max(1, Math.min(720, Math.round(minutes)))
}

export function buildFormSubmitterHash(testId: string, userId: string) {
  return createHash('sha256')
    .update(`${testId}:${userId}:${HASH_SECRET}`)
    .digest('hex')
}

function readOptions(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function uniqueTexts(values: unknown, maxItems = 20) {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const text = cleanFormText(raw, 180)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length >= maxItems) break
  }
  return out
}

function cleanScaleNumber(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

export function sanitizeFormQuestion(raw: unknown, sortOrder: number): QuestionInput {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const type = isFormQuestionType(input.type) ? input.type : 'LONG_TEXT'
  const optionInput = readOptions(input.options)
  const pointsNumber = typeof input.points === 'number' ? input.points : Number(input.points ?? 0)
  const base: QuestionInput = {
    id: cleanFormText(input.id),
    type,
    title: cleanFormText(input.title, 500),
    description: cleanLongFormText(input.description, 1000) || null,
    required: input.required !== false,
    options: null,
    points: Number.isFinite(pointsNumber) ? Math.max(0, Math.min(100, Math.round(pointsNumber))) : 0,
    sortOrder,
  }

  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
    const choices = uniqueTexts(optionInput.choices)
    const choiceSet = new Set(choices)
    const correct = uniqueTexts(optionInput.correct).filter((choice) => choiceSet.has(choice))
    base.options = { choices, correct }
  }

  if (type === 'SCALE') {
    const min = cleanScaleNumber(optionInput.min, 1)
    const max = Math.max(min + 1, cleanScaleNumber(optionInput.max, 5))
    base.options = {
      min,
      max,
      minLabel: cleanFormText(optionInput.minLabel, 80),
      maxLabel: cleanFormText(optionInput.maxLabel, 80),
    }
  }

  return base
}

export function sanitizeFormQuestions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => sanitizeFormQuestion(item, index)).filter((question) => question.title)
}

export function validateQuestionsForPublish(questions: readonly QuestionInput[] | readonly FormQuestionLike[]) {
  if (questions.length === 0) return 'Mindestens eine Frage ist erforderlich'

  for (const question of questions) {
    if (!cleanFormText(question.title, 500)) return 'Jede Frage braucht einen Titel'
    if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
      const choices = getChoiceOptions(question.options)
      if (choices.length < 2) return 'Auswahlfragen brauchen mindestens zwei Antworten'
    }
  }

  return null
}

export function getChoiceOptions(options: unknown) {
  const object = readOptions(options)
  return uniqueTexts(object.choices)
}

export function getCorrectOptions(options: unknown) {
  const choices = new Set(getChoiceOptions(options))
  const object = readOptions(options)
  return uniqueTexts(object.correct).filter((choice) => choices.has(choice))
}

export function getScaleOptions(options: unknown) {
  const object = readOptions(options)
  const min = cleanScaleNumber(object.min, 1)
  const max = Math.max(min + 1, cleanScaleNumber(object.max, 5))
  return {
    min,
    max,
    minLabel: cleanFormText(object.minLabel, 80),
    maxLabel: cleanFormText(object.maxLabel, 80),
  }
}

export function stripCorrectAnswersFromQuestion<T extends { options?: unknown; type: string }>(question: T) {
  if (question.type !== 'SINGLE_CHOICE' && question.type !== 'MULTIPLE_CHOICE') return question
  const options = readOptions(question.options)
  return {
    ...question,
    options: {
      ...options,
      correct: [],
    },
  }
}

function normalizeAnswerForQuestion(question: FormQuestionLike, raw: unknown): Record<string, unknown> | null {
  if (question.type === 'SHORT_TEXT' || question.type === 'LONG_TEXT') {
    const text = cleanLongFormText(raw, 10000)
    return text ? { text } : null
  }

  if (question.type === 'SINGLE_CHOICE') {
    const selected = cleanFormText(raw, 180)
    if (!selected || !getChoiceOptions(question.options).includes(selected)) return null
    return { selected }
  }

  if (question.type === 'MULTIPLE_CHOICE') {
    const selected = uniqueTexts(raw).filter((choice) => getChoiceOptions(question.options).includes(choice))
    return selected.length > 0 ? { selected } : null
  }

  if (question.type === 'SCALE') {
    const { min, max } = getScaleOptions(question.options)
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) return null
    const rounded = Math.round(value)
    if (rounded < min || rounded > max) return null
    return { value: rounded }
  }

  return null
}

export function normalizeSubmittedAnswers(
  questions: readonly FormQuestionLike[],
  rawAnswers: unknown,
) {
  const answerInput = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)
    ? rawAnswers as Record<string, unknown>
    : {}

  const normalized: NormalizedAnswer[] = []
  const errors: string[] = []

  for (const question of questions) {
    const value = normalizeAnswerForQuestion(question, answerInput[question.id])
    if (!value) {
      if (question.required) errors.push(`"${question.title}" muss beantwortet werden`)
      continue
    }
    normalized.push({ questionId: question.id, value })
  }

  return { normalized, errors }
}

export function calculateResponseScore(
  questions: readonly FormQuestionLike[],
  answers: readonly NormalizedAnswer[],
) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.value]))
  let score = 0
  let maxScore = 0

  for (const question of questions) {
    const points = Math.max(0, Math.round(question.points || 0))
    if (points <= 0) continue
    maxScore += points

    const answer = answerMap.get(question.id)
    if (!answer) continue

    if (question.type === 'SINGLE_CHOICE') {
      const correct = getCorrectOptions(question.options)
      if (correct.length > 0 && answer.selected === correct[0]) score += points
    }

    if (question.type === 'MULTIPLE_CHOICE') {
      const correct = getCorrectOptions(question.options).sort()
      const selected = Array.isArray(answer.selected)
        ? answer.selected.map(String).sort()
        : []
      if (
        correct.length > 0 &&
        selected.length === correct.length &&
        selected.every((value, index) => value === correct[index])
      ) {
        score += points
      }
    }
  }

  return { score: maxScore > 0 ? score : null, maxScore }
}
