import {
  deleteDiscordHrEventMessage,
  editDiscordHrEventMessage,
  sendDiscordHrEvent,
  type DiscordField,
} from './discord-integration'
import { prisma } from './prisma'
import {
  AGGRAVATING_CIRCUMSTANCES,
  MITIGATING_CIRCUMSTANCES,
  normalizeCircumstances,
  penalGradeLabel,
  requiresDualControl,
  resolveSanctionLevel,
  resolveViolation,
  sanctionLevelLabel,
} from './sanction-catalog'

export {
  AGGRAVATING_CIRCUMSTANCES,
  CATALOG_PRINCIPLE,
  CATALOG_VERSION,
  DECISION_CHECKLIST,
  DUAL_CONTROL_FROM_GRADE,
  MITIGATING_CIRCUMSTANCES,
  PENAL_GRADES,
  PENAL_GRADE_ORDER,
  PENAL_GRADE_RULES,
  PROCEDURE_STEPS,
  REPEAT_RULES,
  SANCTION_AUTHORITIES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  SANCTION_VIOLATIONS,
  authorityForSanction,
  isChecklistComplete,
  isPenalGrade,
  isSanctionLevel,
  normalizeChecklist,
  normalizeCircumstances,
  penalGradeLabel,
  recommendedLevel,
  regularLevelForGrade,
  requiresDualControl,
  resolvePenalGrade,
  resolveSanctionLevel,
  resolveViolation,
  sanctionLevelLabel,
  sanctionMeasureLabel,
  violationsForGrade,
  type PenalGrade,
  type SanctionLevel,
} from './sanction-catalog'

export const SANCTION_STATUSES = new Set(['ISSUED', 'EXECUTED', 'IN_COURT', 'UPHELD', 'REVOKED'])

/** Status, in denen die Maßnahme noch aussteht oder wirkt. */
export const ACTIVE_SANCTION_STATUSES = ['ISSUED', 'EXECUTED', 'IN_COURT'] as const

export const sanctionInclude = {
  agent: { include: { rank: true } },
  issuedBy: { select: { displayName: true, discordId: true } },
  confirmedBy: { select: { displayName: true } },
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

export function parseSuspendedUntil(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return null
  const date = new Date(raw.length <= 10 ? `${raw}T23:59:59` : raw)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

/** Suspendierungsdauer in Stunden ab jetzt (Stufe 05, Dauer nach Einzelfall). */
export function suspendedUntilFromHours(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const hours = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 8760) return undefined
  const until = new Date()
  until.setHours(until.getHours() + hours)
  return until
}

export function sanctionStatusLabel(status: string) {
  switch (status) {
    case 'EXECUTED':
      return 'Vollzogen'
    case 'IN_COURT':
      return 'Einspruch / Klage'
    case 'UPHELD':
      return 'Bestätigt'
    case 'REVOKED':
      return 'Aufgehoben'
    default:
      return 'Ausgesprochen'
  }
}

export function readCircumstances(value: unknown, kind: 'mitigating' | 'aggravating') {
  return normalizeCircumstances(
    value,
    kind === 'mitigating' ? MITIGATING_CIRCUMSTANCES : AGGRAVATING_CIRCUMSTANCES,
  )
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

function sanctionDiscordFields(sanction: SanctionWithRelations): DiscordField[] {
  const level = resolveSanctionLevel(sanction.level)
  const violation = resolveViolation(sanction.violationCode)

  const fields: DiscordField[] = [
    { name: 'Grund', value: sanction.reason, inline: false },
    {
      name: 'Einstufung',
      value: `\`PG ${sanction.penalGrade}\` · ${penalGradeLabel(sanction.penalGrade)}`,
      inline: true,
    },
    {
      name: 'Maßnahme',
      value: `**${sanctionLevelLabel(sanction.level)}**`,
      inline: true,
    },
  ]

  if (violation) {
    fields.push({ name: 'Verstoß', value: violation.label, inline: false })
  }

  if (level?.suspends && sanction.suspendedUntil) {
    fields.push({
      name: 'Suspendiert bis',
      value: `${formatDateTime(sanction.suspendedUntil)} · ${discordRelativeTimestamp(sanction.suspendedUntil)}`,
      inline: true,
    })
  }

  const aggravating = readCircumstances(sanction.aggravating, 'aggravating')
  if (aggravating.length > 0) {
    fields.push({ name: 'Erschwerend', value: aggravating.join(' · '), inline: false })
  }

  const mitigating = readCircumstances(sanction.mitigating, 'mitigating')
  if (mitigating.length > 0) {
    fields.push({ name: 'Mildernd', value: mitigating.join(' · '), inline: false })
  }

  if (sanction.penalty) {
    fields.push({ name: 'Weitere Folge', value: sanction.penalty, inline: false })
  }

  if (requiresDualControl(sanction.penalGrade)) {
    fields.push({
      name: 'Vier-Augen-Bestätigung',
      value: sanction.confirmedBy?.displayName
        ? `${sanction.confirmedBy.displayName} · ${formatDateTime(sanction.confirmedAt)}`
        : 'Ausstehend',
      inline: true,
    })
  }

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

/**
 * Beendet abgelaufene Suspendierungen. Ersetzt die frühere Fristen-Automatik
 * der Geldsanktionen — der Katalog v1.0 kennt keine Zahlungsfristen mehr.
 */
export async function runSanctionSuspensionAutomation(options?: { now?: Date; limit?: number }) {
  const now = options?.now ?? new Date()
  const expired = await prisma.sanction.findMany({
    where: {
      status: 'EXECUTED',
      level: '05',
      suspendedUntil: { not: null, lte: now },
      resolvedAt: null,
    },
    orderBy: { suspendedUntil: 'asc' },
    take: options?.limit ?? 50,
    select: { id: true },
  })

  let resolved = 0
  let failed = 0

  for (const item of expired) {
    try {
      await prisma.sanction.update({
        where: { id: item.id },
        data: { status: 'UPHELD', resolvedAt: now },
      })
      const updated = await getSanctionById(item.id)
      if (updated) {
        await syncSanctionDiscordMessage(updated, {
          description: 'Suspendierung abgelaufen; der Dienst kann wieder aufgenommen werden.',
          allowCreate: false,
        })
      }
      resolved += 1
    } catch (error) {
      failed += 1
      console.error('[Sanctions] Suspendierung konnte nicht beendet werden:', error)
    }
  }

  return {
    suspensionsChecked: expired.length,
    suspensionsResolved: resolved,
    suspensionsFailed: failed,
  }
}
