import { prisma } from '../prisma'
import { getUserByDiscordId, type CurrentUser } from '../auth'
import { hasPermission } from '../permissions'
import { createAuditLog } from '../audit/audit'
import { isUniqueConstraintError } from '../core/prisma-errors'
import { actionRow, componentMessage, textDisplay } from '../discord/discord-components'
import { DiscordApiError, discordFetch, postChannelMessage, queueDiscordInvestigationEvent } from '../discord/discord-integration'
import { AiError, isAiEnabled, suggestText } from './ai-server'

/**
 * KI-Vorschläge im Discord-Beitrag einer Akte. Zwei Wege:
 * - Jede Textnachricht eines Agents im Beitrag bekommt automatisch eine
 *   Antwort mit dem ausformulierten Eintrag.
 * - `/fib-ki stichworte:…` erzeugt einen Vorschlag aus Stichwörtern.
 * „Übernehmen“ schreibt ihn im Namen des Verfassers in die Chronologie,
 * beide Knöpfe löschen die Vorschlagsnachricht.
 */

export const AI_ACCEPT_PREFIX = 'fib_ai_accept:'
export const AI_REJECT_PREFIX = 'fib_ai_reject:'

const SUCCESS = 3
const DANGER = 4
const ALREADY_DECIDED = 'Dieser Vorschlag wurde schon übernommen oder verworfen.'

/** Nachricht mit dem Vorschlag. Reine Funktion, damit sie testbar ist. */
export function aiProposalMessage(input: { id: string; requesterDiscordId: string; title: string; content: string; missing: string[]; note?: string | null }) {
  const missing = input.missing.length ? `\n-# Fehlt: ${input.missing.join(' · ')}` : ''
  const note = input.note ? `\n-# ${input.note}` : ''
  return {
    ...componentMessage([
      textDisplay(`-# 🤖 Vorschlag für die Akte · <@${input.requesterDiscordId}>\n**${input.title}**\n${input.content}${missing}${note}`.slice(0, 3600)),
      actionRow([
        { type: 2, style: SUCCESS, label: 'Übernehmen', custom_id: `${AI_ACCEPT_PREFIX}${input.id}` },
        { type: 2, style: DANGER, label: 'Verwerfen', custom_id: `${AI_REJECT_PREFIX}${input.id}` },
      ]),
    ]),
    // Den Verfasser nur nennen, nicht pingen.
    allowed_mentions: { parse: [] },
  }
}

async function managerFor(discordId: string | null) {
  const user = discordId ? await getUserByDiscordId(discordId) : null
  if (!user || !hasPermission(user, 'investigations:manage')) return null
  return user
}

async function deleteMessage(channelId: string, messageId: string | null) {
  if (!messageId) return
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' })
    .catch((error) => { if (!(error instanceof DiscordApiError && error.status === 404)) throw error })
}

async function react(channelId: string, messageId: string, emoji: string) {
  await discordFetch(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT' })
    .catch((error) => console.warn('[AI] Reaktion fehlgeschlagen:', error))
}

/** `/fib-ki` im Beitrag einer Akte. Gibt die (nur für den Aufrufer sichtbare) Antwort zurück. */
export async function createDiscordAiProposal(input: { channelId: string | null; discordId: string | null; keywords: string }) {
  const investigation = input.channelId
    ? await prisma.investigation.findFirst({ where: { discordThreadId: input.channelId }, select: { id: true } })
    : null
  if (!investigation || !input.channelId) return 'Den KI-Vorschlag gibt es nur im Forum-Beitrag einer Einsatzakte.'
  const user = await managerFor(input.discordId)
  if (!user) return 'Dein Discord-Konto darf keine Akten bearbeiten.'

  let suggestion
  try {
    suggestion = await suggestText({ kind: 'entry', keywords: input.keywords, investigationId: investigation.id }, user)
  } catch (error) {
    if (error instanceof AiError) return `❌ ${error.message}`
    throw error
  }

  const proposal = await prisma.aiProposal.create({
    data: { investigationId: investigation.id, channelId: input.channelId, requesterDiscordId: input.discordId!, title: suggestion.title, content: suggestion.content },
    select: { id: true },
  })
  const message = await postChannelMessage(input.channelId, aiProposalMessage({ id: proposal.id, requesterDiscordId: input.discordId!, ...suggestion }))
  await prisma.aiProposal.update({ where: { id: proposal.id }, data: { messageId: message.id }, select: { id: true } })
  return '🤖 Der Vorschlag steht im Beitrag. Mit „Übernehmen“ wird er zum Chronologie-Eintrag.'
}

export type ThreadMessageForAi = {
  id: string
  channelId: string
  text: string
  authorDiscordId: string
  authorName: string
  timestamp: Date
}

/** Vorschlag aus einer Nachricht formulieren; ohne KI (Fehler, Limit) bleibt der Originaltext. */
async function formulate(message: ThreadMessageForAi, investigationId: string, user: CurrentUser) {
  try {
    const suggestion = await suggestText({ kind: 'entry', source: 'message', keywords: message.text, investigationId }, user)
    return { ...suggestion, note: null }
  } catch (error) {
    if (!(error instanceof AiError)) console.error('[AI] Vorschlag aus Discord-Nachricht fehlgeschlagen:', error)
    const reason = error instanceof AiError ? error.message : 'Die KI konnte keinen Vorschlag erstellen.'
    return { title: `Discord · ${message.authorName}`.slice(0, 200), content: message.text.slice(0, 4000), missing: [], note: `Originaltext – ${reason}` }
  }
}

/**
 * Textnachricht im Akten-Beitrag: als Antwort darauf einen ausformulierten
 * Eintrag vorschlagen. `false` = KI aus, der Aufrufer übernimmt die Nachricht
 * dann wie bisher direkt.
 */
export async function proposeThreadEntry(message: ThreadMessageForAi, investigationId: string, user: CurrentUser) {
  if (!await isAiEnabled()) return false
  if (await prisma.aiProposal.findUnique({ where: { sourceMessageId: message.id }, select: { id: true } })) return true

  const suggestion = await formulate(message, investigationId, user)
  let proposalId: string
  try {
    const proposal = await prisma.aiProposal.create({
      data: {
        investigationId, channelId: message.channelId, requesterDiscordId: message.authorDiscordId, sourceMessageId: message.id,
        title: suggestion.title, content: suggestion.content, occurredAt: message.timestamp,
      },
      select: { id: true },
    })
    proposalId = proposal.id
  } catch (error) {
    if (isUniqueConstraintError(error)) return true // gleichzeitig schon vorgeschlagen
    throw error
  }

  const posted = await postChannelMessage(message.channelId, {
    ...aiProposalMessage({ id: proposalId, requesterDiscordId: message.authorDiscordId, ...suggestion }),
    message_reference: { message_id: message.id, fail_if_not_exists: false },
  })
  await prisma.aiProposal.update({ where: { id: proposalId }, data: { messageId: posted.id }, select: { id: true } })
  return true
}

/**
 * Die Ursprungsnachricht wurde bearbeitet. Offener Vorschlag → neu formulieren.
 * `true` = die Nachricht gehört zu einem KI-Vorschlag und ist damit erledigt;
 * ein übernommener Eintrag wird nicht mit dem Rohtext überschrieben.
 */
export async function refreshThreadProposal(message: ThreadMessageForAi) {
  const proposal = await prisma.aiProposal.findUnique({
    where: { sourceMessageId: message.id },
    select: { id: true, status: true, investigationId: true, messageId: true, channelId: true },
  })
  if (!proposal) return false
  if (proposal.status !== 'PENDING' || !proposal.messageId) return true
  const user = await managerFor(message.authorDiscordId)
  if (!user) return true

  const suggestion = await formulate(message, proposal.investigationId, user)
  const updated = await prisma.aiProposal.updateMany({
    where: { id: proposal.id, status: 'PENDING' },
    data: { title: suggestion.title, content: suggestion.content },
  })
  if (!updated.count) return true
  await discordFetch(`/channels/${proposal.channelId}/messages/${proposal.messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(aiProposalMessage({ id: proposal.id, requesterDiscordId: message.authorDiscordId, ...suggestion })),
  }).catch((error) => console.warn('[AI] Vorschlag konnte nicht aktualisiert werden:', error))
  return true
}

/** Nur der Verfasser entscheidet über den eigenen Vorschlag – der Eintrag erscheint ja in seinem Namen. */
async function decider(proposal: { requesterDiscordId: string }, discordId: string | null): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await managerFor(discordId)
  if (!user) return { error: 'Dein Discord-Konto darf keine Akten bearbeiten.' }
  if (discordId !== proposal.requesterDiscordId) return { error: `Nur <@${proposal.requesterDiscordId}> kann diesen Vorschlag übernehmen oder verwerfen.` }
  return { user }
}

/** Knopf „Übernehmen“: Eintrag im Namen des Verfassers anlegen, Vorschlag löschen. */
export async function acceptDiscordAiProposal(proposalId: string, discordId: string | null) {
  const proposal = await prisma.aiProposal.findUnique({
    where: { id: proposalId },
    include: { investigation: { select: { id: true, caseNumber: true, title: true } } },
  })
  if (!proposal || proposal.status !== 'PENDING') return ALREADY_DECIDED
  const check = await decider(proposal, discordId)
  if ('error' in check) return check.error
  const user = check.user

  // Erst den Status setzen: so kann ein Doppelklick keinen zweiten Eintrag anlegen.
  const claimed = await prisma.aiProposal.updateMany({ where: { id: proposalId, status: 'PENDING' }, data: { status: 'ACCEPTED', decidedAt: new Date() } })
  if (!claimed.count) return ALREADY_DECIDED

  let entry: { id: string }
  try {
    entry = await prisma.investigationEntry.create({
      data: {
        investigationId: proposal.investigationId,
        kind: 'NOTE',
        title: proposal.title,
        content: proposal.content,
        occurredAt: proposal.occurredAt ?? new Date(),
        participants: [],
        createdById: user.id,
        // Verknüpft mit der Ursprungsnachricht: kein Doppelimport, kein Rückspiegeln.
        discordMessageId: proposal.sourceMessageId,
      },
      select: { id: true },
    })
  } catch (error) {
    // Nichts angelegt – Vorschlag wieder freigeben, damit man es erneut versuchen kann.
    await prisma.aiProposal.updateMany({ where: { id: proposalId }, data: { status: 'PENDING', decidedAt: null } })
    throw error
  }
  await prisma.investigation.update({ where: { id: proposal.investigationId }, data: { updatedAt: new Date() }, select: { id: true } })
  await createAuditLog({
    action: 'INVESTIGATION_ENTRY_CREATED',
    userId: user.id,
    details: `Akte ${proposal.investigation.caseNumber}: KI-Vorschlag „${proposal.title}“ aus Discord übernommen`,
  })
  await deleteMessage(proposal.channelId, proposal.messageId)
  if (proposal.sourceMessageId) {
    // Die Ursprungsnachricht steht schon im Beitrag; ein Haken genügt.
    await react(proposal.channelId, proposal.sourceMessageId, '✅')
  } else {
    queueDiscordInvestigationEvent({
      type: 'entry',
      investigationId: proposal.investigationId,
      entryId: entry.id,
      caseNumber: proposal.investigation.caseNumber,
      title: proposal.investigation.title,
      actorName: user.displayName,
    })
  }
  return '✅ Übernommen – der Eintrag steht jetzt in der Chronologie.'
}

/** Knopf „Verwerfen“: Vorschlag löschen, nichts anlegen. */
export async function rejectDiscordAiProposal(proposalId: string, discordId: string | null) {
  const proposal = await prisma.aiProposal.findUnique({ where: { id: proposalId }, select: { status: true, channelId: true, messageId: true, requesterDiscordId: true } })
  if (!proposal || proposal.status !== 'PENDING') return ALREADY_DECIDED
  const check = await decider(proposal, discordId)
  if ('error' in check) return check.error
  const claimed = await prisma.aiProposal.updateMany({ where: { id: proposalId, status: 'PENDING' }, data: { status: 'REJECTED', decidedAt: new Date() } })
  if (!claimed.count) return ALREADY_DECIDED
  await deleteMessage(proposal.channelId, proposal.messageId)
  return '🗑️ Vorschlag verworfen – in der Akte wurde nichts eingetragen.'
}
