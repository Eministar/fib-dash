import { createAuditLog } from './audit'
import {
  deleteDiscordHrEventMessage,
  editDiscordHrEventMessage,
  sendDiscordHrEvent,
  type DiscordField,
} from './discord-integration'
import { prisma } from './prisma'
import {
  formatFineAmount,
  normalizeSanctionMeasureType,
  penalGradeLabel,
  sanctionMeasureLabel,
  resolveSanctionPenalty,
} from './sanction-catalog'

export {
  PENAL_GRADES,
  formatFineAmount,
  isSanctionMeasureType,
  normalizeSanctionMeasureType,
  penalGradeLabel,
  sanctionMeasureLabel,
  resolveSanctionPenalty,
  resolveSanctionMeasure,
  type SanctionMeasureType,
} from './sanction-catalog'
export const SANCTION_STATUSES = new Set(['OPEN', 'PAID', 'ESCALATED', 'IN_COURT'])

export const sanctionInclude = {
  agent: { include: { rank: true } },
  issuedBy: { select: { displayName: true, discordId: true } },
} as const

export async function getSanctionById(id: string) {
  return prisma.sanction.findUnique({
    where: { id },
    include: sanctionInclude,
  })
}

export type SanctionWithRelations = NonNullable<Awaited<ReturnType<typeof getSanctionById>>>

export function cleanSanctionText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseDeadlineDays(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const days = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) return undefined
  return days
}

export function dueAtFromDeadlineDays(days: number | null) {
  if (days === null) return null
  const dueAt = new Date()
  dueAt.setDate(dueAt.getDate() + days)
  return dueAt
}

export function parseDueAt(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return null
  const date = new Date(raw.length <= 10 ? `${raw}T23:59:59` : raw)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

export function sanctionStatusLabel(status: string) {
  switch (status) {
    case 'PAID':
      return 'Bezahlt'
    case 'ESCALATED':
      return 'Nicht bezahlt / verdoppelt'
    case 'IN_COURT':
      return 'In Klage'
    default:
      return 'Offen'
  }
}

function formatDateTime(value: Date | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  }).format(value)
}

function agentSnapshot(sanction: SanctionWithRelations) {
  if (sanction.agent) return sanction.agent
  return {
    firstName: sanction.previousFirstName || 'Unbekannter',
    lastName: sanction.previousLastName || 'Agent',
    badgeNumber: sanction.previousBadgeNumber || '—',
    discordId: null,
    rankId: '',
    rank: { name: sanction.previousRank || '—', color: null },
  }
}

function sanctionAgentName(sanction: SanctionWithRelations) {
  const agent = agentSnapshot(sanction)
  return `${agent.firstName} ${agent.lastName}`.trim()
}

function discordRelativeTimestamp(value: Date) {
  return `<t:${Math.floor(value.getTime() / 1000)}:R>`
}

function sanctionDeadlineValue(sanction: SanctionWithRelations) {
  if (!sanction.dueAt) return 'Keine Frist'
  if (sanction.status === 'OPEN') {
    return `${formatDateTime(sanction.dueAt)} · ${discordRelativeTimestamp(sanction.dueAt)}`
  }
  return formatDateTime(sanction.dueAt)
}

function sanctionDiscordFields(sanction: SanctionWithRelations): DiscordField[] {
  const measureType = normalizeSanctionMeasureType(sanction.measureType)
  const fields: DiscordField[] = [
    { name: 'Grund', value: sanction.reason, inline: false },
    {
      name: 'Einstufung',
      value: `\`${sanction.penalGrade}\` · ${penalGradeLabel(sanction.penalGrade)}`,
      inline: true,
    },
    {
      name: 'Maßnahme',
      value: measureType === 'SG_ROUNDS'
        ? `**${sanction.sgRounds ?? '—'} SG-Runden**`
        : `**Geldstrafe: ${formatFineAmount(sanction.fineAmount)}**`,
      inline: true,
    },
  ]
  if (sanction.penalty) {
    fields.push({ name: 'Grade-Folge', value: sanction.penalty, inline: false })
  }
  fields.push({ name: 'Frist', value: sanctionDeadlineValue(sanction), inline: true })
  fields.push({ name: 'Status', value: sanctionStatusLabel(sanction.status), inline: true })
  return fields
}

export async function syncSanctionDiscordMessage(
  sanction: SanctionWithRelations,
  options?: { description?: string; note?: string; allowCreate?: boolean },
) {
  const snapshot = agentSnapshot(sanction)
  const event = {
    type: 'sanction' as const,
    title: `Sanktion: ${sanctionAgentName(sanction)}`,
    description: [options?.description, options?.note].filter(Boolean).join('\n') || undefined,
    agent: snapshot,
    actor: sanction.issuedBy ?? undefined,
    fields: sanctionDiscordFields(sanction),
    mentionUserIds: snapshot.discordId ? [snapshot.discordId] : undefined,
  }

  try {
    if (sanction.discordChannelId && sanction.discordMessageId) {
      await editDiscordHrEventMessage(sanction.discordChannelId, sanction.discordMessageId, event)
      return { channelId: sanction.discordChannelId, messageId: sanction.discordMessageId }
    }

    if (options?.allowCreate === false) return null
    const message = await sendDiscordHrEvent(event)
    if (message) {
      await prisma.sanction.update({
        where: { id: sanction.id },
        data: {
          discordChannelId: message.channelId,
          discordMessageId: message.messageId,
        },
      })
    }
    return message
  } catch (error) {
    console.error('[Sanctions] Discord-Mitteilung konnte nicht synchronisiert werden:', error)
    return null
  }
}

export async function deleteSanctionDiscordMessage(sanction: SanctionWithRelations) {
  if (!sanction.discordChannelId || !sanction.discordMessageId) return
  try {
    await deleteDiscordHrEventMessage(sanction.discordChannelId, sanction.discordMessageId)
  } catch (error) {
    console.error('[Sanctions] Discord-Nachricht konnte nicht gelöscht werden:', error)
  }
}

export async function escalateSanction(
  sanctionId: string,
  options?: { actorUserId?: string; now?: Date; manual?: boolean },
) {
  const source = await getSanctionById(sanctionId)
  if (!source) throw new Error('Sanktion nicht gefunden')
  if (source.status !== 'OPEN') return null

  const now = options?.now ?? new Date()
  const measureType = normalizeSanctionMeasureType(source.measureType)
  const sourceRule = resolveSanctionPenalty(source.penalGrade)
  const sourceRounds = source.sgRounds ?? sourceRule?.sgRounds ?? null
  const doubledFine = measureType === 'FINE' && source.fineAmount !== null
    ? Math.min(source.fineAmount * 2, 2_147_483_647)
    : null
  const doubledRounds = measureType === 'SG_ROUNDS' && sourceRounds !== null
    ? Math.min(sourceRounds * 2, 2_147_483_647)
    : null
  const actorUserId = options?.actorUserId || source.issuedByUserId
  const originalMeasure = sanctionMeasureLabel({ measureType, fineAmount: source.fineAmount, sgRounds: sourceRounds })
  const newMeasure = sanctionMeasureLabel({ measureType, fineAmount: doubledFine, sgRounds: doubledRounds })
  const dueText = source.dueAt ? formatDateTime(source.dueAt) : 'ohne Frist'
  const agent = agentSnapshot(source)

  const created = await prisma.$transaction(async (tx) => {
    const claimed = await tx.sanction.updateMany({
      where: { id: sanctionId, status: 'OPEN' },
      data: {
        status: 'ESCALATED',
        escalatedAt: now,
        resolvedAt: now,
      },
    })
    if (claimed.count === 0) return null

    return tx.sanction.create({
      data: {
        agentId: source.agentId,
        reason: `Nicht bezahlt bis ${dueText}. Ursprünglicher Grund: ${source.reason}`,
        penalGrade: source.penalGrade,
        measureType,
        fineAmount: doubledFine,
        sgRounds: doubledRounds,
        penalty: source.penalty
          ? `${source.penalty}\nAutomatische Verdopplung wegen nicht bezahlter Sanktion.`
          : 'Automatische Verdopplung wegen nicht bezahlter Sanktion.',
        issuedByUserId: actorUserId,
        parentSanctionId: source.id,
        previousRank: source.agent?.rank?.name ?? source.previousRank,
        previousBadgeNumber: agent.badgeNumber,
        previousFirstName: agent.firstName,
        previousLastName: agent.lastName,
      },
    })
  })

  if (!created) return null

  const [original, createdSanction] = await Promise.all([
    getSanctionById(source.id),
    getSanctionById(created.id),
  ])
  if (!original || !createdSanction) return null

  await Promise.all([
    syncSanctionDiscordMessage(original, {
      description: 'Sanktion wurde nicht bezahlt. Es wurde eine weitere Sanktion erstellt.',
      note: `Maßnahme: ${originalMeasure} → ${newMeasure}`,
    }),
    syncSanctionDiscordMessage(createdSanction, {
      description: 'Automatische Folgesanktion wegen nicht bezahlter Sanktion.',
    }),
  ])

  await createAuditLog({
    action: options?.manual ? 'SANCTION_ESCALATED_MANUALLY' : 'SANCTION_AUTO_ESCALATED',
    userId: actorUserId,
    agentId: source.agentId ?? undefined,
    oldValue: originalMeasure,
    newValue: newMeasure,
    details: `${sanctionAgentName(source)}: Sanktion nicht bezahlt, Maßnahme verdoppelt (${originalMeasure} → ${newMeasure})`,
  })

  return { original, createdSanction }
}

export async function runSanctionDeadlineAutomation(options?: { now?: Date; limit?: number }) {
  const now = options?.now ?? new Date()
  const overdue = await prisma.sanction.findMany({
    where: {
      status: 'OPEN',
      dueAt: { not: null, lte: now },
    },
    orderBy: { dueAt: 'asc' },
    take: options?.limit ?? 50,
    select: { id: true },
  })

  let escalated = 0
  let skipped = 0
  let failed = 0

  for (const item of overdue) {
    try {
      const result = await escalateSanction(item.id, { now })
      if (result) escalated += 1
      else skipped += 1
    } catch (error) {
      failed += 1
      console.error('[Sanctions] Automatische Verdopplung fehlgeschlagen:', error)
    }
  }

  return {
    sanctionsChecked: overdue.length,
    sanctionsEscalated: escalated,
    sanctionsSkipped: skipped,
    sanctionsFailed: failed,
  }
}
