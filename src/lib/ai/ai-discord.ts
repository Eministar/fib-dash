import { prisma } from '../prisma'
import { getUserByDiscordId } from '../auth'
import { hasPermission } from '../permissions'
import { createAuditLog } from '../audit/audit'
import { actionRow, componentMessage, separator, textDisplay } from '../discord/discord-components'
import { DiscordApiError, discordFetch, postChannelMessage, queueDiscordInvestigationEvent } from '../discord/discord-integration'
import { AiError, suggestText } from './ai-server'

/**
 * KI-Vorschläge im Discord-Beitrag einer Akte: `/fib-ki stichworte:…` erzeugt
 * eine Bot-Nachricht mit dem Vorschlag und zwei Knöpfen. „Übernehmen“ schreibt
 * ihn als Chronologie-Eintrag in die Akte, beide Knöpfe löschen den Vorschlag.
 */

export const AI_ACCEPT_PREFIX = 'fib_ai_accept:'
export const AI_REJECT_PREFIX = 'fib_ai_reject:'

const SUCCESS = 3
const DANGER = 4

/** Nachricht mit dem Vorschlag. Reine Funktion, damit sie testbar ist. */
export function aiProposalMessage(input: { id: string; requesterDiscordId: string; title: string; content: string; missing: string[] }) {
  const missing = input.missing.length
    ? `\n\n**Fehlt noch** (wurde nicht erfunden):\n${input.missing.map((item) => `- ${item}`).join('\n')}`
    : ''
  return {
    ...componentMessage([
      textDisplay(`### 🤖 KI-Vorschlag für <@${input.requesterDiscordId}>\n-# Nur aus deinen Stichwörtern und der Akte formuliert – bitte prüfen.`),
      separator(),
      textDisplay(`**${input.title}**\n${input.content}${missing}`.slice(0, 3600)),
      actionRow([
        { type: 2, style: SUCCESS, label: 'Übernehmen', custom_id: `${AI_ACCEPT_PREFIX}${input.id}` },
        { type: 2, style: DANGER, label: 'Verwerfen', custom_id: `${AI_REJECT_PREFIX}${input.id}` },
      ]),
    ]),
    // Nur den Anfragenden erwähnen, nicht pingen.
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

/** Knopf „Übernehmen“: Eintrag anlegen, Vorschlag löschen, Eintrag wie gewohnt im Beitrag zeigen. */
export async function acceptDiscordAiProposal(proposalId: string, discordId: string | null) {
  const user = await managerFor(discordId)
  if (!user) return 'Dein Discord-Konto darf keine Akten bearbeiten.'
  const proposal = await prisma.aiProposal.findUnique({
    where: { id: proposalId },
    include: { investigation: { select: { id: true, caseNumber: true, title: true } } },
  })
  if (!proposal) return 'Dieser Vorschlag wurde schon übernommen oder verworfen.'

  // Löschen zuerst: so kann ein Doppelklick keinen zweiten Eintrag anlegen.
  const removed = await prisma.aiProposal.deleteMany({ where: { id: proposalId } })
  if (!removed.count) return 'Dieser Vorschlag wurde schon übernommen oder verworfen.'

  const entry = await prisma.investigationEntry.create({
    data: {
      investigationId: proposal.investigationId,
      kind: 'NOTE',
      title: proposal.title,
      content: proposal.content,
      occurredAt: new Date(),
      participants: [],
      createdById: user.id,
    },
    select: { id: true },
  })
  await prisma.investigation.update({ where: { id: proposal.investigationId }, data: { updatedAt: new Date() }, select: { id: true } })
  await createAuditLog({
    action: 'INVESTIGATION_ENTRY_CREATED',
    userId: user.id,
    details: `Akte ${proposal.investigation.caseNumber}: KI-Vorschlag „${proposal.title}“ aus Discord übernommen`,
  })
  await deleteMessage(proposal.channelId, proposal.messageId)
  queueDiscordInvestigationEvent({
    type: 'entry',
    investigationId: proposal.investigationId,
    entryId: entry.id,
    caseNumber: proposal.investigation.caseNumber,
    title: proposal.investigation.title,
    actorName: user.displayName,
  })
  return '✅ Übernommen – der Eintrag steht jetzt in der Chronologie.'
}

/** Knopf „Verwerfen“: Vorschlag löschen, nichts anlegen. */
export async function rejectDiscordAiProposal(proposalId: string, discordId: string | null) {
  const user = await managerFor(discordId)
  if (!user) return 'Dein Discord-Konto darf keine Akten bearbeiten.'
  const proposal = await prisma.aiProposal.findUnique({ where: { id: proposalId }, select: { channelId: true, messageId: true } })
  if (!proposal) return 'Dieser Vorschlag wurde schon übernommen oder verworfen.'
  await prisma.aiProposal.deleteMany({ where: { id: proposalId } })
  await deleteMessage(proposal.channelId, proposal.messageId)
  return '🗑️ Vorschlag verworfen.'
}
