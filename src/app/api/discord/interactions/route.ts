import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { getUserByDiscordId } from '@/lib/auth'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'
import {
  findBadgeNumberConflict,
  getBlacklistedBadgeRows,
  releaseTerminatedBadgeNumber,
  releaseTerminatedBadgeNumberConflicts,
} from '@/lib/badge-blacklist'
import { nextBadgeForRank, normalizeBadgeNumber, rankHasBadgeRange } from '@/lib/badge-number'
import { normalizeUnitKeys } from '@/lib/agent-units'
import {
  getDiscordApplicationId,
  getDiscordConfig,
  queueDiscordAbsenceStatusUpdate,
  queueDiscordDutyStatusUpdate,
  queueDiscordHrEvent,
  queueAgentRoleSync,
} from '@/lib/discord-integration'
import { cancelAbsenceNotice, createAbsenceNotice, formatAbsenceDate, parseAbsenceDate } from '@/lib/absence-status'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { queueDiscordWebhookEvent } from '@/lib/discord-webhook'
import { DISCORD_COMMANDS } from '@/lib/discord-commands'
import { eligibleTrainingsForRank, isTrainingAvailableForRank } from '@/lib/agent-trainings'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'
import { getManagedUnitKeysForUser, hasGlobalAdministratorAccess, unitLeadershipChangeError } from '@/lib/unit-leadership'

export const runtime = 'nodejs'

type DiscordOption = {
  name: string
  type: number
  value?: string | boolean
  focused?: boolean
}

type DiscordInteraction = {
  id?: string
  application_id?: string
  token?: string
  type: number
  data?: {
    name?: string
    custom_id?: string
    options?: DiscordOption[]
    components?: Array<{
      type: number
      components?: Array<{
        type: number
        custom_id?: string
        value?: string
      }>
    }>
  }
  member?: {
    roles?: string[]
    permissions?: string
    user?: {
      id: string
      username?: string
      global_name?: string | null
    }
  }
  user?: {
    id: string
    username?: string
    global_name?: string | null
  }
}

const PUBLIC_KEY_PREFIX = '302a300506032b6570032100'
const EPHEMERAL = 64
const APPLICATION_COMMAND = 2
const MESSAGE_COMPONENT = 3
const AUTOCOMPLETE = 4
const MODAL_SUBMIT = 5
const ADMINISTRATOR = BigInt(8)
const MODAL_CALLBACK = 9
const DEFERRED_CHANNEL_MESSAGE = 5
const DEFERRED_UPDATE_MESSAGE = 6

const FIB_COMMAND_PREFIX = 'fib-'
const FIB_COMMAND_NAMES = new Set(DISCORD_COMMANDS.map((command) => command.name))
const FIB_CUSTOM_ID_PREFIX = 'fib_'
const STALE_DUTY_ACTIVITY_CONFIRM_PREFIX = 'fib_duty_activity_confirm:'

function json(data: unknown) {
  return NextResponse.json(data)
}

function reply(content: string) {
  return json({ type: 4, data: { content, flags: EPHEMERAL } })
}

function deferEphemeral() {
  return json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } })
}

function silentAck() {
  return json({ type: DEFERRED_UPDATE_MESSAGE })
}

function isFibCustomId(customId: string | undefined | null) {
  if (!customId) return false
  if (customId.startsWith(FIB_CUSTOM_ID_PREFIX)) return true
  if (customId.startsWith(STALE_DUTY_ACTIVITY_CONFIRM_PREFIX)) return true
  return false
}

function isFibCommandName(commandName: string | undefined | null): commandName is string {
  return !!commandName && commandName.startsWith(FIB_COMMAND_PREFIX)
}

function isKnownFibCommand(commandName: string | undefined | null): commandName is string {
  return !!commandName && FIB_COMMAND_NAMES.has(commandName)
}

function unhandledInteraction(interaction: DiscordInteraction, title: string) {
  logConsole('warn', `${title} · interaction=${interactionLabel(interaction)} · type=${interaction.type}`)
  return new NextResponse(null, { status: 202 })
}

function modal(data: unknown) {
  return json({ type: MODAL_CALLBACK, data })
}

function autocomplete(choices: { name: string; value: string }[]) {
  return json({ type: 8, data: { choices: choices.slice(0, 25) } })
}

function option(options: DiscordOption[] | undefined, name: string) {
  return options?.find((item) => item.name === name)?.value
}

function textOption(options: DiscordOption[] | undefined, name: string) {
  const value = option(options, name)
  return typeof value === 'string' ? value.trim() : ''
}

function boolOption(options: DiscordOption[] | undefined, name: string) {
  return option(options, name) === true
}

function userOption(options: DiscordOption[] | undefined, name: string) {
  return textOption(options, name)
}

function modalValue(interaction: DiscordInteraction, customId: string) {
  const rows = interaction.data?.components ?? []
  for (const row of rows) {
    const component = row.components?.find((item) => item.custom_id === customId)
    if (typeof component?.value === 'string') return component.value.trim()
  }
  return ''
}

function actorFromInteraction(interaction: DiscordInteraction) {
  const user = interaction.member?.user ?? interaction.user
  return {
    displayName: user?.global_name || user?.username || 'Discord Command',
    discordId: user?.id ?? null,
  }
}

function interactionLabel(interaction: DiscordInteraction) {
  if (interaction.data?.custom_id) return interaction.data.custom_id
  if (interaction.data?.name) return interaction.data.name
  return `type-${interaction.type}`
}

function logConsole(level: 'log' | 'warn' | 'error', message: string, extra?: unknown) {
  const ts = new Date().toISOString()
  const prefix = `[DiscordInteractions ${ts}]`
  if (extra !== undefined) console[level](prefix, message, extra)
  else console[level](prefix, message)
}

function logInteraction(
  interaction: DiscordInteraction | null,
  title: string,
  severity: 'info' | 'success' | 'warning' | 'error',
  details?: { message?: string; error?: unknown },
) {
  const actor = interaction ? actorFromInteraction(interaction) : null
  const label = interaction ? interactionLabel(interaction) : 'unbekannt'
  const consoleLevel = severity === 'error' ? 'error' : severity === 'warning' ? 'warn' : 'log'
  logConsole(consoleLevel, `${title} · interaction=${label} · type=${interaction?.type ?? '-'} · discordId=${actor?.discordId ?? '-'}`, details?.error ?? details?.message)
  queueDiscordWebhookEvent({
    title,
    description: details?.message,
    severity,
    source: 'discord-interactions',
    fields: [
      { name: 'Interaktion', value: label, inline: true },
      { name: 'Typ', value: interaction ? String(interaction.type) : 'unbekannt', inline: true },
      { name: 'Discord-ID', value: actor?.discordId ?? 'unbekannt', inline: true },
    ],
    error: details?.error,
  })
}

function hasAdminPermission(permissions: string | undefined) {
  try {
    return permissions !== undefined && (BigInt(permissions) & ADMINISTRATOR) === ADMINISTRATOR
  } catch {
    return false
  }
}

async function verifySignature(req: NextRequest, rawBody: string) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim() || process.env.FIB_DISCORD_PUBLIC_KEY?.trim() || ''
  if (!publicKey) {
    logConsole('error', 'DISCORD_PUBLIC_KEY ist nicht gesetzt — alle Interaktionen werden abgelehnt. Setze die Env-Variable in der .env.')
    queueDiscordWebhookEvent({
      title: 'Discord-Interaktion abgelehnt',
      description: 'DISCORD_PUBLIC_KEY ist nicht gesetzt.',
      severity: 'error',
      source: 'discord-interactions',
    })
    return false
  }

  const signature = req.headers.get('x-signature-ed25519')
  const timestamp = req.headers.get('x-signature-timestamp')
  if (!signature || !timestamp) {
    logConsole('error', 'Signatur-Header fehlen (x-signature-ed25519 / x-signature-timestamp).')
    queueDiscordWebhookEvent({
      title: 'Discord-Interaktion abgelehnt',
      description: 'Signatur-Header fehlen.',
      severity: 'error',
      source: 'discord-interactions',
    })
    return false
  }

  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(`${PUBLIC_KEY_PREFIX}${publicKey}`, 'hex'),
      format: 'der',
      type: 'spki',
    })
    const valid = crypto.verify(null, Buffer.from(`${timestamp}${rawBody}`), key, Buffer.from(signature, 'hex'))
    if (!valid) {
      logConsole('error', 'Signatur-Verifizierung fehlgeschlagen — DISCORD_PUBLIC_KEY passt vermutlich nicht zum Bot.')
      queueDiscordWebhookEvent({
        title: 'Discord-Interaktion abgelehnt',
        description: 'Signatur-Verifizierung fehlgeschlagen. Der Public Key passt wahrscheinlich nicht zur Discord-App.',
        severity: 'error',
        source: 'discord-interactions',
      })
    }
    return valid
  } catch (e) {
    logConsole('error', 'Signatur-Verifizierung warf Exception (vermutlich Public-Key-Format falsch).', e)
    queueDiscordWebhookEvent({
      title: 'Discord-Interaktion abgelehnt',
      description: 'Signatur-Verifizierung ist mit einem Fehler abgebrochen.',
      severity: 'error',
      source: 'discord-interactions',
      error: e,
    })
    return false
  }
}

async function ensureAllowed(interaction: DiscordInteraction) {
  const config = await getDiscordConfig()
  if (hasAdminPermission(interaction.member?.permissions)) return true

  const memberRoles = interaction.member?.roles ?? []
  return config.commandRoleIds.length > 0 && config.commandRoleIds.some((roleId) => memberRoles.includes(roleId))
}

async function isLinkedAgent(discordId: string | null | undefined) {
  if (!discordId) return false
  const agent = await prisma.agent.findFirst({
    where: { discordId, status: { not: 'TERMINATED' } },
    select: { id: true },
  })
  return !!agent
}

async function findRank(value: string) {
  return prisma.rank.findFirst({
    where: {
      OR: [
        { id: value },
        { name: { equals: value } },
      ],
    },
  })
}

async function findTraining(value: string) {
  return prisma.training.findFirst({
    where: {
      OR: [
        { id: value },
        { key: { equals: value } },
        { label: { equals: value } },
      ],
    },
    include: { minRank: true },
  })
}

async function findUnit(value: string) {
  return prisma.unit.findFirst({
    where: {
      OR: [
        { key: { equals: value } },
        { name: { equals: value } },
      ],
    },
  })
}

async function unitKeysFromText(value: string) {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
  const units = await Promise.all(parts.map(findUnit))
  return normalizeUnitKeys(units.filter(Boolean).map((unit) => unit!.key))
}

async function unitAssignmentError(
  actor: ReturnType<typeof actorFromInteraction>,
  existingUnits: string[],
  nextUnits: string[],
  discordAdministrator: boolean,
) {
  if (discordAdministrator) return null

  const appUser = actor.discordId ? await getUserByDiscordId(actor.discordId) : null
  if (appUser && hasGlobalAdministratorAccess(appUser)) return null

  const managedUnitKeys = appUser ? await getManagedUnitKeysForUser(appUser) : []
  return unitLeadershipChangeError(existingUnits, nextUnits, managedUnitKeys)
}

async function systemUserId() {
  const user = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
  if (!user) throw new Error('Es existiert kein Dashboard-Benutzer für Log-Einträge.')
  return user.id
}

async function autocompleteFor(kind: 'rang' | 'ausbildung' | 'unit', query: string) {
  const contains = query.trim()
  if (kind === 'rang') {
    const rows = await prisma.rank.findMany({
      where: contains ? { name: { contains } } : undefined,
      orderBy: { sortOrder: 'asc' },
      take: 25,
    })
    return autocomplete(rows.map((rank) => ({ name: rank.name, value: rank.id })))
  }
  if (kind === 'ausbildung') {
    const rows = await prisma.training.findMany({
      where: contains ? { label: { contains } } : undefined,
      orderBy: { sortOrder: 'asc' },
      take: 25,
    })
    return autocomplete(rows.map((training) => ({ name: training.label, value: training.id })))
  }

  const rows = await prisma.unit.findMany({
    where: {
      active: true,
      ...(contains ? { name: { contains } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    take: 25,
  })
  return autocomplete(rows.map((unit) => ({ name: unit.name, value: unit.key })))
}

async function sendFollowup(interaction: DiscordInteraction, content: string) {
  const appId = interaction.application_id || getDiscordApplicationId()
  const token = interaction.token
  if (!appId || !token) {
    logConsole('error', 'Followup nicht möglich — application_id oder interaction-token fehlt.', { appId, hasToken: !!token })
    queueDiscordWebhookEvent({
      title: 'Discord-Followup nicht möglich',
      description: !appId
        ? 'DISCORD_APPLICATION_ID (oder DISCORD_CLIENT_ID) ist nicht gesetzt — Followup kann nicht gesendet werden.'
        : 'Interaction-Token fehlt im Payload.',
      severity: 'error',
      source: 'discord-interactions',
    })
    return
  }
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}`
  const trimmed = content.length > 1900 ? `${content.slice(0, 1900)}…` : content
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: trimmed, flags: EPHEMERAL }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      logConsole('error', `Followup HTTP ${res.status}`, txt)
      queueDiscordWebhookEvent({
        title: 'Discord-Followup fehlgeschlagen',
        severity: 'error',
        source: 'discord-interactions',
        description: txt.slice(0, 1000),
        fields: [
          { name: 'Status', value: String(res.status), inline: true },
          { name: 'Interaktion', value: interactionLabel(interaction), inline: true },
        ],
      })
    }
  } catch (e) {
    logConsole('error', 'Followup-Exception', e)
    queueDiscordWebhookEvent({
      title: 'Discord-Followup Exception',
      severity: 'error',
      source: 'discord-interactions',
      fields: [{ name: 'Interaktion', value: interactionLabel(interaction), inline: true }],
      error: e,
    })
  }
}

function runDeferred(interaction: DiscordInteraction, label: string, work: () => Promise<string>) {
  after(async () => {
    try {
      const content = await work()
      await sendFollowup(interaction, content)
    } catch (e: unknown) {
      const message = isUniqueConstraintError(e)
        ? 'Discord-ID ist bereits vergeben.'
        : e instanceof Error
          ? e.message
          : 'Serverfehler'
      logInteraction(interaction, `Discord ${label} fehlgeschlagen`, 'error', { message, error: e })
      await sendFollowup(interaction, `❌ ${message}`)
    }
  })
  return deferEphemeral()
}

async function performHire(
  options: DiscordOption[] | undefined,
  actor: ReturnType<typeof actorFromInteraction>,
  discordAdministrator: boolean,
) {
  const discordId = userOption(options, 'discord')
  const firstName = textOption(options, 'vorname')
  const lastName = textOption(options, 'nachname')
  const rank = await findRank(textOption(options, 'rang'))
  if (!discordId || !firstName || !lastName || !rank) return 'Discord-User, Vorname, Nachname und Rang sind erforderlich.'

  const existingDiscord = await prisma.agent.findFirst({ where: { discordId } })
  if (existingDiscord) return 'Dieser Discord-User ist bereits einem Agent zugeordnet.'

  const prefix = await getBadgePrefix()
  let badgeNumber = textOption(options, 'dienstnummer')
  if (badgeNumber) badgeNumber = normalizeBadgeNumber(badgeNumber, prefix)
  if (!badgeNumber) {
    const [allRows, blacklistedBadges] = await Promise.all([
      prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } }),
      getBlacklistedBadgeRows(),
    ])
    const assigned = nextBadgeForRank(rank, allRows, prefix, null, blacklistedBadges)
    if (!assigned) return 'Keine freie Dienstnummer im Bereich des ausgewählten Rangs.'
    badgeNumber = assigned.str
  }

  const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
  const conflict = await findBadgeNumberConflict(badgeNumber, prefix, null, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
  if (conflict) return conflict
  await releaseTerminatedBadgeNumberConflicts(badgeNumber, prefix)

  const unitKeys = await unitKeysFromText(textOption(options, 'units'))
  if (unitKeys.length > 0) {
    const leadershipError = await unitAssignmentError(actor, [], unitKeys, discordAdministrator)
    if (leadershipError) return leadershipError
  }

  const agent = await prisma.agent.create({
    data: {
      discordId,
      firstName,
      lastName,
      rankId: rank.id,
      badgeNumber,
      status: 'ACTIVE',
      unit: unitKeys[0] ?? null,
      units: unitKeys,
      hireDate: new Date(),
    },
    include: { rank: true },
  })

  const trainings = await prisma.training.findMany({ include: { minRank: true } })
  const eligibleTrainings = eligibleTrainingsForRank(trainings, rank)
  if (eligibleTrainings.length > 0) {
    await prisma.agentTraining.createMany({
      data: eligibleTrainings.map((training) => ({ agentId: agent.id, trainingId: training.id, completed: false })),
    })
  }

  queueAgentRoleSync(agent.id)
  await syncLinkedUserDisplayNameForAgent(agent)
  queueDiscordHrEvent({
    type: 'hire',
    title: 'Neuer Beitritt',
    agent,
    actor,
  })

  return `Einstellung erstellt: ${firstName} ${lastName} (${badgeNumber})`
}

async function performPromotion(options: DiscordOption[] | undefined, actor: ReturnType<typeof actorFromInteraction>) {
  const discordId = userOption(options, 'discord')
  const agent = await prisma.agent.findFirst({ where: { discordId }, include: { rank: true } })
  const newRank = await findRank(textOption(options, 'rang'))
  if (!agent || !newRank) return 'Agent oder neuer Rang wurde nicht gefunden.'

  const prefix = await getBadgePrefix()
  let newBadgeNumber = textOption(options, 'dienstnummer')
  if (newBadgeNumber) newBadgeNumber = normalizeBadgeNumber(newBadgeNumber, prefix)
  if (!newBadgeNumber) {
    if (rankHasBadgeRange(newRank)) {
      const [allRows, blacklistedBadges] = await Promise.all([
        prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } }),
        getBlacklistedBadgeRows(),
      ])
      const assigned = nextBadgeForRank(newRank, allRows, prefix, agent.badgeNumber, blacklistedBadges)
      // Bereich voll → Agent behält seine bisherige Dienstnummer
      newBadgeNumber = assigned ? assigned.str : agent.badgeNumber
    } else {
      newBadgeNumber = agent.badgeNumber
    }
  }

  if (newBadgeNumber !== agent.badgeNumber) {
    const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
    const conflict = await findBadgeNumberConflict(newBadgeNumber, prefix, agent.id, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
    if (conflict) return conflict
    await releaseTerminatedBadgeNumberConflicts(newBadgeNumber, prefix)
  }

  await prisma.promotionLog.create({
    data: {
      agentId: agent.id,
      oldRankId: agent.rankId,
      newRankId: newRank.id,
      oldBadgeNumber: agent.badgeNumber,
      newBadgeNumber,
      performedByUserId: await systemUserId(),
      note: textOption(options, 'notiz') || 'Discord-Command',
    },
  })

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { rankId: newRank.id, badgeNumber: newBadgeNumber },
    include: { rank: true },
  })

  const note = textOption(options, 'notiz')
  await syncLinkedUserDisplayNameForAgent(updated)
  queueAgentRoleSync(agent.id)
  queueDiscordHrEvent({
    type: 'promotion',
    title: `Rangänderung: ${agent.firstName} ${agent.lastName}`,
    description: note ? `**Anmerkung:** ${note}` : undefined,
    agent: updated,
    actor,
    fields: [
      { name: 'Alter Rang', value: agent.rank.name, inline: true },
      { name: 'Neuer Rang', value: `**${newRank.name}**`, inline: true },
      { name: 'DN-Wechsel', value: `${agent.badgeNumber} → **${newBadgeNumber}**`, inline: true },
    ],
  })

  return `Rang geändert: ${agent.firstName} ${agent.lastName} von ${agent.rank.name} auf ${newRank.name}.`
}

async function performTraining(options: DiscordOption[] | undefined, actor: ReturnType<typeof actorFromInteraction>) {
  const discordId = userOption(options, 'discord')
  const agent = await prisma.agent.findFirst({ where: { discordId }, include: { rank: true } })
  const training = await findTraining(textOption(options, 'ausbildung'))
  if (!agent || !training) return 'Agent oder Ausbildung wurde nicht gefunden.'
  if (!isTrainingAvailableForRank(training, agent.rank)) {
    return 'Diese Ausbildung ist für den Rang dieses Agents nicht verfügbar.'
  }

  const completed = boolOption(options, 'abgeschlossen')
  const previousTraining = await prisma.agentTraining.findUnique({
    where: { agentId_trainingId: { agentId: agent.id, trainingId: training.id } },
    select: { completed: true },
  })
  await prisma.agentTraining.upsert({
    where: { agentId_trainingId: { agentId: agent.id, trainingId: training.id } },
    create: { agentId: agent.id, trainingId: training.id, completed },
    update: { completed },
  })

  queueAgentRoleSync(agent.id)
  queueDiscordHrEvent({
    type: 'training',
    title: `Ausbildung aktualisiert: ${agent.firstName} ${agent.lastName}`,
    agent,
    actor,
    trainingChanges: [{
      trainingId: training.id,
      label: training.label,
      completed,
      previousCompleted: previousTraining?.completed ?? false,
    }],
  })

  return `${training.label} wurde für ${agent.firstName} ${agent.lastName} auf ${completed ? 'abgeschlossen' : 'offen'} gesetzt.`
}

async function performUnit(
  options: DiscordOption[] | undefined,
  actor: ReturnType<typeof actorFromInteraction>,
  discordAdministrator: boolean,
) {
  const discordId = userOption(options, 'discord')
  const action = textOption(options, 'aktion')
  const unit = await findUnit(textOption(options, 'unit'))
  const agent = await prisma.agent.findFirst({ where: { discordId }, include: { rank: true } })
  if (!agent || !unit) return 'Agent oder Unit wurde nicht gefunden.'

  const current = normalizeUnitKeys(agent.units ?? (agent.unit ? [agent.unit] : []))
  const next = action === 'set'
    ? [unit.key]
    : action === 'remove'
      ? current.filter((key) => key !== unit.key)
      : Array.from(new Set([...current, unit.key]))

  const leadershipError = await unitAssignmentError(actor, current, next, discordAdministrator)
  if (leadershipError) return leadershipError

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { unit: next[0] ?? null, units: next },
    include: { rank: true },
  })

  queueAgentRoleSync(agent.id)
  queueDiscordHrEvent({
    type: 'units',
    title: `Unit-Zuordnung: ${agent.firstName} ${agent.lastName}`,
    description: 'Die neue organisatorische Zuordnung gilt ab sofort.',
    agent: updated,
    actor,
    unitChange: { previous: current, current: next },
  })

  return `Units aktualisiert: ${updated.firstName} ${updated.lastName} → ${next.join(', ') || 'keine Unit'}.`
}

async function performTermination(options: DiscordOption[] | undefined, actor: ReturnType<typeof actorFromInteraction>) {
  const discordId = userOption(options, 'discord')
  const reason = textOption(options, 'grund')
  const agent = await prisma.agent.findFirst({ where: { discordId }, include: { rank: true } })
  if (!agent) return 'Agent wurde nicht gefunden.'
  if (agent.status === 'TERMINATED') return 'Agent ist bereits gekündigt.'
  if (!reason) return 'Ein Grund ist erforderlich.'

  await prisma.$transaction(async (tx) => {
    await tx.termination.create({
      data: {
        agentId: agent.id,
        reason,
        terminatedByUserId: await systemUserId(),
        previousRank: agent.rank.name,
        previousBadgeNumber: agent.badgeNumber,
        previousFirstName: agent.firstName,
        previousLastName: agent.lastName,
      },
    })
    await tx.agent.update({ where: { id: agent.id }, data: { status: 'TERMINATED' } })
    await releaseTerminatedBadgeNumber(agent, tx)
  })

  queueAgentRoleSync(agent.id, 'remove-all')
  queueDiscordHrEvent({
    type: 'termination',
    title: `Kündigung: ${agent.firstName} ${agent.lastName}`,
    agent,
    actor,
    fields: [{ name: 'Grund', value: reason, inline: false }],
  })

  return `Kündigung eingetragen: ${agent.firstName} ${agent.lastName}.`
}

async function performAbsence(
  options: DiscordOption[] | undefined,
  actor: ReturnType<typeof actorFromInteraction>,
  interaction: DiscordInteraction,
) {
  const actorDiscordId = actor.discordId
  const targetDiscordId = userOption(options, 'discord') || actorDiscordId || ''
  if (!targetDiscordId) return 'Discord-User konnte nicht erkannt werden.'

  if (targetDiscordId !== actorDiscordId && !(await ensureAllowed(interaction))) {
    return 'Du darfst keine Abmeldungen für andere Agents erstellen.'
  }

  const agent = await prisma.agent.findFirst({
    where: { discordId: targetDiscordId },
    include: { rank: true },
  })
  if (!agent) return 'Agent wurde nicht gefunden. Prüfe die Discord-Verknüpfung im HR-Tool.'

  const startsAt = parseAbsenceDate(textOption(options, 'von')) ?? new Date()
  const endsAt = parseAbsenceUntil(textOption(options, 'bis'), startsAt)
  const reason = textOption(options, 'grund')
  if (!endsAt) return 'Ende ist ungültig. Nutze z.B. 12.05.2026 20:00, 3 Tage oder 1 Woche.'
  if (endsAt <= startsAt) return 'Das Ende muss nach dem Start liegen. Gib ein Datum oder eine Dauer an, die noch nicht abgelaufen ist.'
  if (!reason) return 'Ein Grund ist erforderlich.'

  const result = await createAbsenceNotice({
    agentId: agent.id,
    startsAt,
    endsAt,
    reason,
    source: 'discord',
    actorDiscordId,
  })

  queueDiscordAbsenceStatusUpdate()
  queueAgentRoleSync(agent.id)
  queueDiscordHrEvent({
    type: 'update',
    title: `Abmeldung: ${agent.firstName} ${agent.lastName}`,
    description: 'Für den genannten Zeitraum liegt eine Abmeldung vor.',
    agent: result.agent,
    actor,
    fields: [
      { name: 'Von', value: formatAbsenceDate(startsAt), inline: true },
      { name: 'Bis', value: formatAbsenceDate(endsAt), inline: true },
      { name: 'Grund', value: reason, inline: false },
    ],
  })

  return `Abmeldung eingetragen: ${agent.firstName} ${agent.lastName} · ${formatAbsenceDate(startsAt)} bis ${formatAbsenceDate(endsAt)}.`
}

function parseAbsenceUntil(value: string, now = new Date()) {
  const parsedDate = parseAbsenceDate(value, { hours: 23, minutes: 59 })
  if (parsedDate) return parsedDate

  const input = value.trim().toLowerCase()
  const match = input.match(/^(\d{1,3})(?:\s*(h|std|stunde|stunden|d|t|tag|tage|w|woche|wochen))?$/i)
  if (!match) return null

  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const unit = match[2] ?? 'tage'
  const end = new Date(now)
  if (unit === 'h' || unit === 'std' || unit === 'stunde' || unit === 'stunden') {
    end.setHours(end.getHours() + amount)
    return end
  }

  end.setDate(end.getDate() + amount * (unit === 'w' || unit === 'woche' || unit === 'wochen' ? 7 : 1))
  end.setHours(23, 59, 0, 0)
  return end
}

function absenceModal() {
  return modal({
    custom_id: 'fib_absence_modal',
    title: 'Abmeldung eintragen',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'grund',
            label: 'Grund',
            style: 2,
            required: true,
            min_length: 3,
            max_length: 1000,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'bis',
            label: 'Wie lange?',
            style: 1,
            placeholder: 'z.B. 3 Tage, 1 Woche oder 12.05.2026 20:00',
            required: true,
            min_length: 1,
            max_length: 80,
          },
        ],
      },
    ],
  })
}

async function performAbsenceModal(interaction: DiscordInteraction) {
  const actor = actorFromInteraction(interaction)
  const actorDiscordId = actor.discordId
  if (!actorDiscordId) return 'Discord-User konnte nicht erkannt werden.'

  const agent = await prisma.agent.findFirst({
    where: { discordId: actorDiscordId },
    include: { rank: true },
  })
  if (!agent) return 'Dein Discord-Account ist keinem Agent im HR-Tool zugeordnet.'

  const startsAt = new Date()
  const endsAt = parseAbsenceUntil(modalValue(interaction, 'bis'), startsAt)
  const reason = modalValue(interaction, 'grund')
  if (!endsAt) return 'Ende ist ungültig. Nutze z.B. 12.05.2026 20:00, 3 Tage oder 1 Woche.'
  if (endsAt <= startsAt) return 'Das Ende muss in der Zukunft liegen. Gib ein Datum oder eine Dauer an, die noch nicht abgelaufen ist.'
  if (!reason) return 'Ein Grund ist erforderlich.'

  const result = await createAbsenceNotice({
    agentId: agent.id,
    startsAt,
    endsAt,
    reason,
    source: 'discord',
    actorDiscordId,
  })

  queueDiscordAbsenceStatusUpdate()
  queueAgentRoleSync(agent.id)
  queueDiscordHrEvent({
    type: 'update',
    title: `Abmeldung: ${agent.firstName} ${agent.lastName}`,
    description: 'Für den genannten Zeitraum liegt eine Abmeldung vor.',
    agent: result.agent,
    actor,
    fields: [
      { name: 'Bis', value: formatAbsenceDate(endsAt), inline: true },
      { name: 'Grund', value: reason, inline: false },
    ],
  })

  return `Abmeldung eingetragen bis ${formatAbsenceDate(endsAt)}.`
}

async function performAbsenceCancel(interaction: DiscordInteraction) {
  const actor = actorFromInteraction(interaction)
  const discordId = actor.discordId
  if (!discordId) return 'Discord-User konnte nicht erkannt werden.'

  const now = new Date()
  const absence = await prisma.absenceNotice.findFirst({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now },
      agent: { discordId, status: { not: 'TERMINATED' } },
    },
    include: {
      agent: { include: { rank: true } },
    },
    orderBy: { endsAt: 'desc' },
  })

  if (!absence) return 'Du hast aktuell keine aktive Abmeldung.'

  const updated = await cancelAbsenceNotice(absence.id)
  queueDiscordAbsenceStatusUpdate()
  queueAgentRoleSync(updated.agent.id)
  queueDiscordHrEvent({
    type: 'update',
    title: `Abmeldung beendet: ${updated.agent.firstName} ${updated.agent.lastName}`,
    description: 'Die Abmeldung wurde beendet. Der reguläre Dienststatus gilt wieder.',
    agent: updated.agent,
    actor,
  })

  return 'Deine Abmeldung wurde beendet.'
}

function handleButton(interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id

  if (!isFibCustomId(customId)) {
    return unhandledInteraction(interaction, 'Nicht-HR-Button ignoriert')
  }

  if (customId && customId.startsWith(STALE_DUTY_ACTIVITY_CONFIRM_PREFIX)) {
    return reply('Manuelle Dienstzeit-Bestätigungen sind deaktiviert. Der Dienststatus kommt automatisch aus der Player-Online-API.')
  }

  if (customId === 'fib_absence_create') {
    return absenceModal()
  }

  if (customId === 'fib_duty_refresh') {
    queueDiscordDutyStatusUpdate()
    return reply('Dienstzeiten werden aktualisiert.')
  }

  if (customId === 'fib_absence_refresh') {
    queueDiscordAbsenceStatusUpdate()
    return reply('Abmeldungen werden aktualisiert.')
  }

  if (customId === 'fib_absence_cancel') {
    return runDeferred(interaction, 'Button: Abmeldung beenden', () => performAbsenceCancel(interaction))
  }

  if (customId === 'fib_duty_clock_in') {
    return reply('Manuelles Einstempeln ist deaktiviert. Du wirst automatisch als im Dienst erkannt, wenn du als Police online bist.')
  }

  if (customId === 'fib_duty_clock_out') {
    return reply('Manuelles Ausstempeln ist deaktiviert. Der Dienststatus endet automatisch, sobald du nicht mehr als Police online bist.')
  }

  return silentAck()
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!(await verifySignature(req, rawBody))) {
    return new NextResponse('Invalid request signature', { status: 401 })
  }

  let interaction: DiscordInteraction
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction
  } catch (e) {
    logConsole('error', 'JSON.parse der Interaktion fehlgeschlagen', e)
    queueDiscordWebhookEvent({
      title: 'Discord-Interaktion konnte nicht gelesen werden',
      severity: 'error',
      source: 'discord-interactions',
      error: e,
    })
    return new NextResponse('Bad Request', { status: 400 })
  }

  if (interaction.type === 1) {
    return json({ type: 1 })
  }

  if (interaction.type === AUTOCOMPLETE) {
    if (!isFibCommandName(interaction.data?.name)) {
      return unhandledInteraction(interaction, 'Nicht-HR-Autocomplete ignoriert')
    }

    const focused = interaction.data?.options?.find((item) => item.focused)
    if (focused?.name === 'rang') return autocompleteFor('rang', typeof focused.value === 'string' ? focused.value : '')
    if (focused?.name === 'ausbildung') return autocompleteFor('ausbildung', typeof focused.value === 'string' ? focused.value : '')
    if (focused?.name === 'unit') return autocompleteFor('unit', typeof focused.value === 'string' ? focused.value : '')
    return autocomplete([])
  }

  if (interaction.type === MESSAGE_COMPONENT) {
    try {
      const response = handleButton(interaction)
      return response
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Serverfehler'
      logInteraction(interaction, 'Discord-Button fehlgeschlagen', 'error', { message, error: e })
      return reply(message)
    }
  }

  if (interaction.type === MODAL_SUBMIT) {
    const modalId = interaction.data?.custom_id
    if (modalId === 'fib_absence_modal') {
      return runDeferred(interaction, 'Modal: Abmeldung', () => performAbsenceModal(interaction))
    }
    if (!isFibCustomId(modalId)) {
      return unhandledInteraction(interaction, 'Nicht-HR-Modal ignoriert')
    }
    return silentAck()
  }

  if (interaction.type !== APPLICATION_COMMAND) {
    return unhandledInteraction(interaction, 'Nicht unterstützte Discord-Interaction ignoriert')
  }

  const commandName = interaction.data?.name
  if (!isFibCommandName(commandName)) {
    return unhandledInteraction(interaction, 'Nicht-HR-Discord-Command ignoriert')
  }
  if (!isKnownFibCommand(commandName)) {
    logInteraction(interaction, 'Unbekannter FIB-Discord-Command', 'warning')
    return reply('Unbekannter HR-Command. Registriere die Discord-Commands neu.')
  }

  const actor = actorFromInteraction(interaction)
  const allowed = await ensureAllowed(interaction)
  if (!allowed && !(commandName === 'fib-abmeldung' && await isLinkedAgent(actor.discordId))) {
    logInteraction(interaction, 'Discord-Command abgelehnt', 'warning', { message: 'Keine Berechtigung' })
    return reply('Du darfst diese HR-Commands nicht ausführen.')
  }

  const options = interaction.data?.options
  switch (commandName) {
    case 'fib-einstellung':
      return runDeferred(interaction, `Command: ${commandName}`, () => performHire(options, actor, hasAdminPermission(interaction.member?.permissions)))
    case 'fib-beförderung':
      return runDeferred(interaction, `Command: ${commandName}`, () => performPromotion(options, actor))
    case 'fib-ausbildung':
      return runDeferred(interaction, `Command: ${commandName}`, () => performTraining(options, actor))
    case 'fib-unit':
      return runDeferred(interaction, `Command: ${commandName}`, () => performUnit(options, actor, hasAdminPermission(interaction.member?.permissions)))
    case 'fib-kündigung':
      return runDeferred(interaction, `Command: ${commandName}`, () => performTermination(options, actor))
    case 'fib-abmeldung':
      return runDeferred(interaction, `Command: ${commandName}`, () => performAbsence(options, actor, interaction))
    default:
      logInteraction(interaction, 'Unbekannter FIB-Discord-Command', 'warning')
      return reply('Unbekannter HR-Command. Registriere die Discord-Commands neu.')
  }
}
