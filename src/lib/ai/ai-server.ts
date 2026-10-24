import { prisma } from '../prisma'
import type { CurrentUser } from '../auth'
import { canAccessInvestigation, investigationAccessInclude } from '../investigations/investigations'
import {
  buildSystemPrompt,
  buildUserPrompt,
  contextText,
  maxInputLength,
  parseSuggestion,
  parseThreadPlan,
  reviewSuggestion,
  type AiFamilyContext,
  type AiInvestigationContext,
  type AiSuggestion,
  type AiSuggestionKind,
  type AiThreadPlan,
} from './ai-prompts'

/**
 * KI-Assistent über DeepSeek. Der API-Key steht in der Umgebung
 * (`DEEPSEEK_API_KEY`), an- und abschalten lässt er sich in den Einstellungen.
 */

export const AI_ENABLED_KEY = 'ai.enabled'
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
/** Günstigstes Modell. Per `DEEPSEEK_MODEL` änderbar, falls DeepSeek die Namen ändert. */
const DEFAULT_MODEL = 'deepseek-flash'

export class AiError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function aiKeyConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim())
}

/** Eingeschaltet, sobald ein Key da ist – außer, es wurde in den Einstellungen abgeschaltet. */
export async function isAiEnabled() {
  if (!aiKeyConfigured()) return false
  const setting = await prisma.systemSetting.findUnique({ where: { key: AI_ENABLED_KEY } })
  return setting?.value !== 'false'
}

export async function aiStatus() {
  const configured = aiKeyConfigured()
  return { configured, enabled: configured && await isAiEnabled(), model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL }
}

// Bremse gegen versehentliche Dauerschleifen und Kosten: je Nutzer begrenzt.
const RATE_WINDOW_MS = 10 * 60_000
const RATE_LIMIT = 20
const recentCalls = new Map<string, number[]>()

function checkRateLimit(userId: string) {
  const now = Date.now()
  const calls = (recentCalls.get(userId) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
  if (calls.length >= RATE_LIMIT) throw new AiError('Zu viele KI-Anfragen. Bitte in ein paar Minuten noch einmal versuchen.', 429)
  calls.push(now)
  recentCalls.set(userId, calls)
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function completeJson(messages: ChatMessage[]) {
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPSEEK_API_KEY!.trim()}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
      messages,
      response_format: { type: 'json_object' },
      // 0: wörtlich und wiederholbar statt kreativ.
      temperature: 0,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch((error: unknown) => {
    throw new AiError(error instanceof Error && error.name === 'TimeoutError' ? 'Die KI antwortet gerade nicht. Bitte später noch einmal versuchen.' : 'Die KI ist nicht erreichbar.', 502)
  })
  if (!response.ok) {
    console.error('[AI] DeepSeek antwortete mit', response.status, await response.text().catch(() => ''))
    throw new AiError(response.status === 401 ? 'Der DeepSeek-API-Key ist ungültig.' : response.status === 402 ? 'Das DeepSeek-Guthaben ist aufgebraucht.' : 'Die KI konnte keinen Vorschlag erstellen.', 502)
  }
  const body = await response.json() as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content ?? ''
}

async function familyContext(dossierId: string): Promise<AiFamilyContext | null> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      title: true,
      leader: { select: { firstName: true, lastName: true } },
      persons: { select: { firstName: true, lastName: true }, take: 30 },
    },
  })
  if (!dossier) return null
  const leader = dossier.leader ? [`${dossier.leader.firstName} ${dossier.leader.lastName}`] : []
  return {
    title: dossier.title,
    members: [...new Set([...leader, ...dossier.persons.map((person) => `${person.firstName} ${person.lastName}`)])],
  }
}

/** Aktive Agents in der Schreibweise des Dashboards („Agent Geber“). */
async function agentRoster() {
  const agents = await prisma.agent.findMany({
    where: { status: { not: 'TERMINATED' } },
    select: { firstName: true, lastName: true },
    orderBy: [{ rank: { sortOrder: 'asc' } }, { lastName: 'asc' }],
  })
  return agents.map((agent) => `${agent.firstName} ${agent.lastName}`.trim())
}

async function investigationContext(investigationId: string, user: CurrentUser) {
  const investigation = await prisma.investigation.findUnique({
    where: { id: investigationId },
    include: {
      ...investigationAccessInclude,
      persons: { select: { person: { select: { firstName: true, lastName: true } } }, take: 20 },
      dossiers: { select: { id: true }, take: 1 },
    },
  })
  if (!investigation) throw new AiError('Ermittlungsakte nicht gefunden', 404)
  if (!canAccessInvestigation(user, investigation)) throw new AiError('Kein Zugriff auf diese Akte', 403)
  const context: AiInvestigationContext = {
    caseNumber: investigation.caseNumber,
    title: investigation.title,
    persons: investigation.persons.map((entry) => `${entry.person.firstName} ${entry.person.lastName}`),
  }
  return { context, dossierId: investigation.dossiers[0]?.id ?? null }
}

/**
 * Anfrage mit Prüfung: Beanstandet `review` den ersten Vorschlag, bekommt die KI
 * genau einen zweiten Versuch mit den konkreten Punkten.
 */
async function generate<T>(messages: ChatMessage[], parse: (raw: string) => T, review: (result: T) => string[]) {
  const raw = await completeJson(messages)
  const first = parse(raw)
  const problems = review(first)
  if (!problems.length) return first

  const retry = parse(await completeJson([
    ...messages,
    { role: 'assistant', content: raw },
    { role: 'user', content: `Überarbeite den Vorschlag: ${problems.join(' ')} Halte dich strikt an die Regeln.` },
  ]))
  // Erfundene Zahlen sind ein Ausschlussgrund; ein etwas zu langer Text nicht.
  if (review(retry).some((problem) => problem.startsWith('Die Zahlen'))) {
    throw new AiError('Die KI hat Angaben ergänzt, die nicht in der Eingabe stehen. Bitte noch einmal versuchen oder selbst formulieren.', 422)
  }
  return retry
}

export type SuggestInput = {
  kind: AiSuggestionKind
  keywords: string
  investigationId?: string | null
  dossierId?: string | null
}

/** Vorschlag erzeugen. Wirft `AiError` mit einer Meldung, die der Nutzer sehen darf. */
export async function suggestText(input: SuggestInput, user: CurrentUser): Promise<AiSuggestion> {
  if (!await isAiEnabled()) throw new AiError('Der KI-Assistent ist ausgeschaltet.', 403)
  const keywords = input.keywords.trim()
  if (!keywords) throw new AiError('Bitte mindestens ein Stichwort angeben.')
  if (keywords.length > maxInputLength('keywords')) throw new AiError(`Höchstens ${maxInputLength('keywords')} Zeichen.`)
  if (input.kind === 'entry' && !input.investigationId) throw new AiError('Für einen Chronologie-Eintrag fehlt die Akte.')
  checkRateLimit(user.id)

  const investigation = input.investigationId ? await investigationContext(input.investigationId, user) : null
  const dossierId = input.dossierId || investigation?.dossierId || null
  const family = dossierId ? await familyContext(dossierId) : null

  const promptInput = { kind: input.kind, keywords, investigation: investigation?.context, family, agents: await agentRoster() }
  return generate(
    [{ role: 'system', content: buildSystemPrompt(input.kind) }, { role: 'user', content: buildUserPrompt(promptInput) }],
    parseSuggestion,
    (suggestion) => reviewSuggestion(suggestion, { keywords, context: contextText(promptInput) }),
  )
}

export type ThreadPlanInput = {
  text: string
  investigationId: string
  authorName: string
  attachments: { images: number; videos: number }
}

/** Nachricht aus dem Akten-Beitrag: Eintrag plus Änderungen an der Akte. */
export async function planFromMessage(input: ThreadPlanInput, user: CurrentUser): Promise<AiThreadPlan> {
  if (!await isAiEnabled()) throw new AiError('Der KI-Assistent ist ausgeschaltet.', 403)
  const text = input.text.trim()
  if (!text) throw new AiError('Die Nachricht ist leer.')
  if (text.length > maxInputLength('message')) throw new AiError(`Höchstens ${maxInputLength('message')} Zeichen.`)
  checkRateLimit(user.id)

  const investigation = await investigationContext(input.investigationId, user)
  const family = investigation.dossierId ? await familyContext(investigation.dossierId) : null
  const promptInput = {
    kind: 'entry' as const, source: 'message' as const, keywords: text,
    authorName: input.authorName, attachments: input.attachments, investigation: investigation.context, family,
    agents: await agentRoster(),
  }
  return generate(
    [{ role: 'system', content: buildSystemPrompt('entry', 'message') }, { role: 'user', content: buildUserPrompt(promptInput) }],
    parseThreadPlan,
    (plan) => reviewSuggestion(
      { title: [plan.title, plan.changes.title].filter(Boolean).join(' '), content: plan.content },
      { keywords: text, context: contextText(promptInput) },
    ),
  )
}
