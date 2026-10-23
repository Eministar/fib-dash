import { prisma } from '../prisma'
import { getUserByDiscordId, type CurrentUser } from '../auth'
import { hasPermission } from '../permissions'
import { createAuditLog } from '../audit/audit'
import { isUniqueConstraintError } from '../core/prisma-errors'
import { actionRow, componentMessage, textDisplay } from '../discord/discord-components'
import { DiscordApiError, discordFetch, postChannelMessage, queueDiscordInvestigationEvent } from '../discord/discord-integration'
import { describeActions, hasChanges, NO_ACTIONS, readActions, type ProposalActions } from './ai-proposal-actions'
import { AiError, isAiEnabled, planFromMessage, suggestText } from './ai-server'

/**
 * KI-Vorschläge im Discord-Beitrag einer Akte. Zwei Wege:
 * - Jede Nachricht eines Agents im Beitrag bekommt automatisch eine Antwort
 *   mit dem Vorschlag: ausformulierter Eintrag, Änderungen an der Akte
 *   (Status, Priorität, Fallführung, Ermittler, Personen, Fahrzeuge, Titel)
 *   und die Anhänge.
 * - `/fib-ki stichworte:…` erzeugt einen Eintrag aus Stichwörtern.
 * „Übernehmen“ führt alles im Namen des Verfassers aus, beide Knöpfe löschen
 * die Vorschlagsnachricht.
 */

export const AI_ACCEPT_PREFIX = 'fib_ai_accept:'
export const AI_REJECT_PREFIX = 'fib_ai_reject:'

const SUCCESS = 3
const DANGER = 4
const ALREADY_DECIDED = 'Dieser Vorschlag wurde schon übernommen oder verworfen.'

/** Nachricht mit dem Vorschlag. Reine Funktion, damit sie testbar ist. */
export function aiProposalMessage(input: {
  id: string
  requesterDiscordId: string
  title: string
  content: string
  missing: string[]
  note?: string | null
  actions?: ProposalActions
}) {
  const actions = input.actions ?? NO_ACTIONS
  const entry = input.content ? `**${input.title}**\n${input.content}` : ''
  const changes = describeActions(actions)
  const hints = [
    actions.unresolved.length ? `Nicht zugeordnet: ${actions.unresolved.join(' · ')}` : '',
    input.missing.length ? `Fehlt: ${input.missing.join(' · ')}` : '',
    input.note ?? '',
  ].filter(Boolean).map((hint) => `-# ${hint}`)
  const body = [
    `-# 🤖 Vorschlag für die Akte · <@${input.requesterDiscordId}>`,
    entry,
    changes.length ? `${entry ? '\n' : ''}**Änderungen**\n${changes.join('\n')}` : '',
    ...hints,
  ].filter(Boolean).join('\n')
  return {
    ...componentMessage([
      textDisplay(body.slice(0, 3600)),
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
  attachments: { images: number; videos: number }
}

/** Discord-Erwähnungen `<@123>` in Namen übersetzen, damit die KI sie zuordnen kann. */
async function resolveMentions(text: string) {
  const ids = [...new Set([...text.matchAll(/<@!?(\d{17,22})>/g)].map((match) => match[1]))]
  if (!ids.length) return text
  const agents = await prisma.agent.findMany({
    where: { status: { not: 'TERMINATED' }, OR: [{ discordId: { in: ids } }, { user: { discordId: { in: ids } } }] },
    select: { firstName: true, lastName: true, discordId: true, user: { select: { discordId: true } } },
  })
  const names = new Map<string, string>()
  for (const agent of agents) {
    for (const id of [agent.discordId, agent.user?.discordId]) if (id) names.set(id, `${agent.firstName} ${agent.lastName}`)
  }
  return text.replace(/<@!?(\d{17,22})>/g, (raw, id: string) => names.get(id) ?? raw)
}

type Formulated = { title: string; content: string; missing: string[]; note: string | null; actions: ProposalActions }

/** Vorschlag formulieren; ohne KI (Fehler, Limit) bleibt der Originaltext ohne Änderungen. */
async function formulate(message: ThreadMessageForAi, investigationId: string, user: CurrentUser): Promise<Formulated> {
  const fallbackTitle = `Discord · ${message.authorName}`.slice(0, 200)
  const onlyFiles = { ...NO_ACTIONS, attachments: message.attachments, unresolved: [] }
  if (!message.text) return { title: fallbackTitle, content: '', missing: [], note: null, actions: onlyFiles }
  try {
    const text = await resolveMentions(message.text)
    const plan = await planFromMessage({ text, investigationId, authorName: message.authorName, attachments: message.attachments }, user)
    const { resolvePlan } = await import('./ai-actions')
    const actions = await resolvePlan(plan, { investigationId, authorDiscordId: message.authorDiscordId, attachments: message.attachments })
    // Weder Eintrag noch Änderung erkannt: lieber den Originaltext anbieten als nichts.
    if (!plan.content && !hasChanges(actions)) return { title: fallbackTitle, content: message.text.slice(0, 4000), missing: [], note: null, actions }
    return { title: plan.title || fallbackTitle, content: plan.content, missing: plan.missing, note: null, actions }
  } catch (error) {
    if (!(error instanceof AiError)) console.error('[AI] Vorschlag aus Discord-Nachricht fehlgeschlagen:', error)
    const reason = error instanceof AiError ? error.message : 'Die KI konnte keinen Vorschlag erstellen.'
    return { title: fallbackTitle, content: message.text.slice(0, 4000), missing: [], note: `Originaltext – ${reason}`, actions: onlyFiles }
  }
}

/**
 * Nachricht im Akten-Beitrag: als Antwort darauf einen Vorschlag posten.
 * `false` = KI aus, der Aufrufer übernimmt die Nachricht dann wie bisher direkt.
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
        title: suggestion.title, content: suggestion.content, occurredAt: message.timestamp, actions: suggestion.actions,
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
    data: { title: suggestion.title, content: suggestion.content, actions: suggestion.actions },
  })
  if (!updated.count) return true
  await discordFetch(`/channels/${proposal.channelId}/messages/${proposal.messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(aiProposalMessage({ id: proposal.id, requesterDiscordId: message.authorDiscordId, ...suggestion })),
  }).catch((error) => console.warn('[AI] Vorschlag konnte nicht aktualisiert werden:', error))
  return true
}

/** Nur der Verfasser entscheidet über den eigenen Vorschlag – alles geschieht ja in seinem Namen. */
async function decider(proposal: { requesterDiscordId: string }, discordId: string | null): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await managerFor(discordId)
  if (!user) return { error: 'Dein Discord-Konto darf keine Akten bearbeiten.' }
  if (discordId !== proposal.requesterDiscordId) return { error: `Nur <@${proposal.requesterDiscordId}> kann diesen Vorschlag übernehmen oder verwerfen.` }
  return { user }
}

/** Anhänge der Ursprungsnachricht übernehmen. Die Nachricht wird frisch geladen, weil Discords Datei-Links ablaufen. */
async function importSourceAttachments(proposal: { investigationId: string; channelId: string; sourceMessageId: string | null }, entryId: string | null, userId: string) {
  if (!proposal.sourceMessageId) return null
  const { importMessageAttachments } = await import('../investigations/investigation-forum-inbound')
  const message = await discordFetch<Parameters<typeof importMessageAttachments>[1]>(`/channels/${proposal.channelId}/messages/${proposal.sourceMessageId}`)
    .catch((error) => {
      console.warn('[AI] Ursprungsnachricht für Anhänge nicht abrufbar:', error)
      return null
    })
  if (!message?.attachments?.length) return null
  return importMessageAttachments(proposal.investigationId, message, entryId, userId)
}

/** Knopf „Übernehmen“: Eintrag, Änderungen und Anhänge im Namen des Verfassers, Vorschlag löschen. */
export async function acceptDiscordAiProposal(proposalId: string, discordId: string | null) {
  const proposal = await prisma.aiProposal.findUnique({
    where: { id: proposalId },
    include: { investigation: { select: { id: true, caseNumber: true, title: true } } },
  })
  if (!proposal || proposal.status !== 'PENDING') return ALREADY_DECIDED
  const check = await decider(proposal, discordId)
  if ('error' in check) return check.error
  const user = check.user
  const actions = readActions(proposal.actions)

  // Erst den Status setzen: so kann ein Doppelklick nichts doppelt anlegen.
  const claimed = await prisma.aiProposal.updateMany({ where: { id: proposalId, status: 'PENDING' }, data: { status: 'ACCEPTED', decidedAt: new Date() } })
  if (!claimed.count) return ALREADY_DECIDED

  let entryId: string | null = null
  if (proposal.content) {
    try {
      const entry = await prisma.investigationEntry.create({
        data: {
          investigationId: proposal.investigationId,
          kind: actions.entryKind,
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
      entryId = entry.id
    } catch (error) {
      // Nichts angelegt – Vorschlag wieder freigeben, damit man es erneut versuchen kann.
      await prisma.aiProposal.updateMany({ where: { id: proposalId }, data: { status: 'PENDING', decidedAt: null } })
      throw error
    }
    await createAuditLog({
      action: 'INVESTIGATION_ENTRY_CREATED',
      userId: user.id,
      details: `Akte ${proposal.investigation.caseNumber}: KI-Vorschlag „${proposal.title}“ aus Discord übernommen`,
    })
  }

  const files = await importSourceAttachments(proposal, entryId, user.id)
  const { applyActions } = await import('./ai-actions')
  const changed = await applyActions(proposal.investigationId, actions, user)
  if (!changed.length) await prisma.investigation.update({ where: { id: proposal.investigationId }, data: { updatedAt: new Date() }, select: { id: true } })

  await deleteMessage(proposal.channelId, proposal.messageId)
  if (proposal.sourceMessageId) {
    // Die Ursprungsnachricht steht schon im Beitrag; ein Haken genügt.
    await react(proposal.channelId, proposal.sourceMessageId, files?.failed.length ? '⚠️' : '✅')
  } else if (entryId) {
    queueDiscordInvestigationEvent({
      type: 'entry',
      investigationId: proposal.investigationId,
      entryId,
      caseNumber: proposal.investigation.caseNumber,
      title: proposal.investigation.title,
      actorName: user.displayName,
    })
  }

  const summary = [
    entryId ? 'Eintrag in der Chronologie' : '',
    files?.images ? `${files.images} Bilder` : '',
    files?.videos ? `${files.videos} Videos` : '',
    ...changed,
  ].filter(Boolean)
  const failed = files?.failed.length ? `\n⚠️ Nicht übernommen: ${files.failed.join(', ')}` : ''
  return `✅ Übernommen: ${summary.join(' · ') || 'nichts zu ändern'}${failed}`
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
  return '🗑️ Vorschlag verworfen – an der Akte wurde nichts geändert.'
}
