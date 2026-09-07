import { BarChart3 } from 'lucide-react'

export type ModuleKey = 'ACADEMY' | 'HR' | 'SRU' | 'AIR_SUPPORT' | 'DETECTIVE'
export type FormTestStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type FormTestKind = 'TEST' | 'SURVEY'
export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'SCALE'

export interface QuestionOptions {
  choices?: string[]
  correct?: string[]
  min?: number
  max?: number
  minLabel?: string
  maxLabel?: string
}

export interface FormQuestion {
  id?: string
  type: QuestionType
  title: string
  description: string | null
  required: boolean
  options: QuestionOptions | null
  points: number
  sortOrder: number
}

export interface FormAnswer {
  id: string
  questionId: string
  value: Record<string, unknown>
  question: FormQuestion
}

export interface FormResponse {
  id: string
  respondentName: string
  respondent: { id: string; displayName: string; username: string; discordId: string | null } | null
  score: number | null
  maxScore: number
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: { id: string; displayName: string } | null
  submittedAt: string
  answers: FormAnswer[]
}

export interface FormTestMeta {
  id: string
  module: ModuleKey
  title: string
  kind: FormTestKind
  status: FormTestStatus
  anonymousResponses: boolean
  questions: FormQuestion[]
}

export const STATUS_META: Record<FormTestStatus, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  DRAFT: { label: 'Entwurf', variant: 'warning' },
  ACTIVE: { label: 'Aktiv', variant: 'success' },
  ARCHIVED: { label: 'Archiv', variant: 'default' },
}

export const KIND_META: Record<FormTestKind, { label: string; variant: 'info' | 'warning' }> = {
  TEST: { label: 'Test', variant: 'warning' },
  SURVEY: { label: 'Umfrage', variant: 'info' },
}

export function modulePath(module: ModuleKey) {
  if (module === 'ACADEMY') return '/academy'
  if (module === 'HR') return '/hr'
  if (module === 'SRU') return '/sru'
  if (module === 'AIR_SUPPORT') return '/air-support'
  if (module === 'DETECTIVE') return '/detective'
  return '/'
}

export function responseScore(response: Pick<FormResponse, 'score' | 'maxScore'>) {
  if (response.maxScore <= 0) return 'Ohne Punkte'
  return `${response.score ?? '-'} / ${response.maxScore}`
}

export function answerText(answer: FormAnswer) {
  const value = answer.value
  if (typeof value.text === 'string' && value.text.trim()) return value.text
  if (typeof value.selected === 'string' && value.selected.trim()) return value.selected
  if (Array.isArray(value.selected) && value.selected.length > 0) return value.selected.join(', ')
  if (typeof value.value === 'number') return String(value.value)
  return 'Keine Antwort'
}

export function selectedValues(answer: FormAnswer | undefined) {
  if (!answer) return []
  if (typeof answer.value.selected === 'string') return [answer.value.selected]
  if (Array.isArray(answer.value.selected)) return answer.value.selected.map(String)
  return []
}

export function correctValues(question: FormQuestion) {
  return question.options?.correct ?? []
}

export function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="glass-panel-elevated flex items-center gap-3 rounded-[12px] border border-white/[0.04] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#d4d4d4]/15 text-[#d4d4d4]">{icon}</div>
      <div>
        <p className="text-[20px] font-semibold leading-tight text-white tabular-nums">{value}</p>
        <p className="mt-0.5 text-[11px] text-[#a6a6a6]">{label}</p>
      </div>
    </div>
  )
}

export function QuestionAnalytics({ questions, responses }: { questions: FormQuestion[]; responses: FormResponse[] }) {
  if (questions.length === 0) return null

  return (
    <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 size={15} className="text-[#d4d4d4]" />
        <h3 className="text-[14px] font-semibold text-white">Auswertung</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {questions.map((question) => {
          const answers = responses
            .map((response) => response.answers.find((answer) => answer.questionId === question.id))
            .filter((answer): answer is FormAnswer => Boolean(answer))

          if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
            const choices = question.options?.choices ?? []
            const counts = new Map(choices.map((choice) => [choice, 0]))
            for (const answer of answers) {
              for (const selected of selectedValues(answer)) counts.set(selected, (counts.get(selected) ?? 0) + 1)
            }
            const max = Math.max(1, ...Array.from(counts.values()))
            return (
              <div key={question.id} className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/45 p-3">
                <p className="mb-2 text-[12.5px] font-semibold text-white">{question.title}</p>
                <div className="space-y-2">
                  {choices.map((choice) => {
                    const count = counts.get(choice) ?? 0
                    return (
                      <div key={choice}>
                        <div className="mb-1 flex justify-between gap-2 text-[11.5px]">
                          <span className="truncate text-[#c3c3c3]">{choice}</span>
                          <span className="text-[#909090]">{count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#232323]">
                          <div className="h-full rounded-full bg-[#d4d4d4]" style={{ width: `${Math.round((count / max) * 100)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }

          if (question.type === 'SCALE') {
            const values = answers.map((answer) => Number(answer.value.value)).filter(Number.isFinite)
            const average = values.length > 0 ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '-'
            return (
              <div key={question.id} className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/45 p-3">
                <p className="text-[12.5px] font-semibold text-white">{question.title}</p>
                <p className="mt-2 text-[22px] font-semibold text-[#d4d4d4] tabular-nums">{average}</p>
                <p className="text-[11.5px] text-[#909090]">{values.length} Antwort(en)</p>
              </div>
            )
          }

          return (
            <div key={question.id} className="rounded-[12px] border border-[#343434]/45 bg-[#181818]/45 p-3">
              <p className="text-[12.5px] font-semibold text-white">{question.title}</p>
              <p className="mt-2 text-[22px] font-semibold text-[#d4d4d4] tabular-nums">{answers.length}</p>
              <p className="text-[11.5px] text-[#909090]">Textantwort(en)</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
