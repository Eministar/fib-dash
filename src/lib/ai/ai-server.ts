import { prisma } from '../prisma'
import type { CurrentUser } from '../auth'
import { canAccessInvestigation, investigationAccessInclude, INVESTIGATION_ENTRY_KIND_LABELS, INVESTIGATION_PERSON_ROLE_LABELS, INVESTIGATION_PRIORITY_LABELS, INVESTIGATION_STATUS_LABELS } from '../investigations/investigations'
import { displayBadgeNumber } from '../agents/badge-number'
import {
  buildSystemPrompt,
  buildUserPrompt,
  MAX_KEYWORDS_LENGTH,
  parseSuggestion,
  type AiFamilyContext,
  type AiInvestigationContext,
  type AiSuggestion,
  type AiSuggestionKind,
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

async function completeJson(system: string, user: string) {
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPSEEK_API_KEY!.trim()}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      // Niedrig: lieber trocken und wörtlich als kreativ.
      temperature: 0.2,
      max_tokens: 1200,
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

async function authorContext(user: Pick<CurrentUser, 'id' | 'displayName'>) {
  const agent = await prisma.agent.findFirst({
    where: { user: { id: user.id } },
    select: { firstName: true, lastName: true, badgeNumber: true, rank: { select: { name: true } } },
  })
  return {
    name: agent ? `${agent.firstName} ${agent.lastName}` : user.displayName,
    rank: agent?.rank?.name ?? null,
    badgeNumber: agent ? displayBadgeNumber(agent.badgeNumber) : null,
  }
}

const formatDate = (date: Date) => date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' })

async function familyContext(dossierId: string): Promise<AiFamilyContext | null> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: {
      title: true, address: true,
      leader: { select: { firstName: true, lastName: true } },
      persons: { select: { firstName: true, lastName: true }, take: 30 },
      investigations: { select: { caseNumber: true, title: true }, orderBy: { updatedAt: 'desc' }, take: 10 },
    },
  })
  if (!dossier) return null
  return {
    title: dossier.title,
    leader: dossier.leader ? `${dossier.leader.firstName} ${dossier.leader.lastName}` : null,
    address: dossier.address,
    members: dossier.persons.map((person) => `${person.firstName} ${person.lastName}`),
    recentCases: dossier.investigations.map((item) => `${item.caseNumber} ${item.title}`),
  }
}

async function investigationContext(investigationId: string, user: CurrentUser) {
  const investigation = await prisma.investigation.findUnique({
    where: { id: investigationId },
    include: {
      ...investigationAccessInclude,
      leadAgent: { select: { firstName: true, lastName: true } },
      persons: { select: { role: true, person: { select: { firstName: true, lastName: true } } }, take: 20 },
      entries: { select: { occurredAt: true, kind: true, title: true, content: true }, orderBy: { occurredAt: 'desc' }, take: 8 },
      dossiers: { select: { id: true }, take: 1 },
    },
  })
  if (!investigation) throw new AiError('Ermittlungsakte nicht gefunden', 404)
  if (!canAccessInvestigation(user, investigation)) throw new AiError('Kein Zugriff auf diese Akte', 403)
  const context: AiInvestigationContext = {
    caseNumber: investigation.caseNumber,
    title: investigation.title,
    summary: investigation.summary,
    status: INVESTIGATION_STATUS_LABELS[investigation.status],
    priority: INVESTIGATION_PRIORITY_LABELS[investigation.priority],
    leadAgent: investigation.leadAgent ? `${investigation.leadAgent.firstName} ${investigation.leadAgent.lastName}` : null,
    persons: investigation.persons.map((entry) => `${entry.person.firstName} ${entry.person.lastName} (${INVESTIGATION_PERSON_ROLE_LABELS[entry.role]})`),
    recentEntries: investigation.entries.map((entry) => ({
      date: formatDate(entry.occurredAt),
      kind: INVESTIGATION_ENTRY_KIND_LABELS[entry.kind as keyof typeof INVESTIGATION_ENTRY_KIND_LABELS] ?? entry.kind,
      title: entry.title,
      content: entry.content,
    })),
  }
  return { context, dossierId: investigation.dossiers[0]?.id ?? null }
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
  if (keywords.length > MAX_KEYWORDS_LENGTH) throw new AiError(`Höchstens ${MAX_KEYWORDS_LENGTH} Zeichen Stichwörter.`)
  if (input.kind === 'entry' && !input.investigationId) throw new AiError('Für einen Chronologie-Eintrag fehlt die Akte.')
  checkRateLimit(user.id)

  const investigation = input.investigationId ? await investigationContext(input.investigationId, user) : null
  const dossierId = input.dossierId || investigation?.dossierId || null
  const [author, family] = await Promise.all([authorContext(user), dossierId ? familyContext(dossierId) : null])

  const system = buildSystemPrompt(input.kind)
  const prompt = buildUserPrompt({ kind: input.kind, keywords, author, now: new Date(), investigation: investigation?.context, family })
  const raw = await completeJson(system, prompt)
  return parseSuggestion(raw)
}
