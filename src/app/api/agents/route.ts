import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAgentSchema } from '@/lib/validations/agent'
import { createAuditLog } from '@/lib/audit'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { getAllowDuplicateBadgeNumbers, getBadgePrefix } from '@/lib/settings-helpers'
import { nextBadgeForRank, normalizeBadgeNumber } from '@/lib/badge-number'
import { findBadgeNumberConflict, getBlacklistedBadgeRows, releaseTerminatedBadgeNumberConflicts } from '@/lib/badge-blacklist'
import { normalizeUnitKeys } from '@/lib/agent-units'
import { getManagedUnitKeysForUser, hasGlobalAdministratorAccess, unitLeadershipChangeError } from '@/lib/unit-leadership'
import { eligibleTrainingsForRank, withAgentTrainingRows } from '@/lib/agent-trainings'
import {
  canCheckDiscordGuildMembers,
  getCachedDiscordGuildMembers,
  getDiscordConfig,
  queueDiscordHrEvent,
  queueAgentRoleSync,
  refreshDiscordGuildMembers,
} from '@/lib/discord-integration'
import { runAgentStatusAutomation } from '@/lib/absence-status'
import { syncLinkedUserDisplayNameForAgent } from '@/lib/user-display-name'
import { queueContractForNewAgent } from '@/lib/contract-service'
import { agentAvatarUrl, resolveAgentAvatarUrls } from '@/lib/agent-avatar'

function validDiscordId(value: string | null | undefined) {
  const id = value?.trim()
  return id && /^\d{17,22}$/.test(id) ? id : ''
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('agents:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const { searchParams } = new URL(req.url)
  await runAgentStatusAutomation()
  const search = searchParams.get('search')
  const status = searchParams.get('status')
  const rankId = searchParams.get('rankId')

  const where: Record<string, unknown> = {}
  if (search) {
    const canSearchDiscordId = /^\d{17,22}$/.test(search.trim())
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { badgeNumber: { contains: search } },
      ...(canSearchDiscordId ? [{ discordId: { contains: search } }] : []),
    ]
  }
  if (status) where.status = status
  else where.status = { not: 'TERMINATED' }
  if (rankId) where.rankId = rankId

  const [agents, trainings, discordConfig, canCheckDiscordMembers] = await Promise.all([
    prisma.agent.findMany({
      where,
      include: {
        rank: true,
        trainings: { include: { training: { include: { minRank: true } } } },
      },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    }),
    prisma.training.findMany({
      include: { minRank: true },
      orderBy: { sortOrder: 'asc' },
    }),
    getDiscordConfig(),
    canCheckDiscordGuildMembers(),
  ])
  const cachedDiscordMembers = canCheckDiscordMembers
    ? getCachedDiscordGuildMembers(discordConfig.guildId)
    : null
  if (canCheckDiscordMembers && !cachedDiscordMembers) {
    refreshDiscordGuildMembers(discordConfig.guildId)
  }
  const discordMembers = cachedDiscordMembers ?? []
  const discordMemberIds = new Set(discordMembers.map((member) => member.user?.id).filter(Boolean))
  const avatarUrls = await resolveAgentAvatarUrls(agents)

  return success(agents.map((agent) => {
    const discordId = validDiscordId(agent.discordId)
    return {
      ...withAgentTrainingRows(agent, trainings),
      avatarUrl: agentAvatarUrl(agent, avatarUrls),
      discordMember: {
        checked: canCheckDiscordMembers && cachedDiscordMembers !== null && !!discordId,
        inGuild: !!discordId && discordMemberIds.has(discordId),
      },
    }
  }))
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN', 'HR'], ['agents:write'])
    const body = await req.json()
    const parsed = createAgentSchema.safeParse(body)
    if (!parsed.success) {
      return error(parsed.error.issues.map(e => e.message).join(', '))
    }

    const rank = await prisma.rank.findUnique({ where: { id: parsed.data.rankId } })
    if (!rank) return error('Rang nicht gefunden')

    let badgeNumber = parsed.data.badgeNumber?.trim() ?? ''
    const prefix = await getBadgePrefix()
    if (badgeNumber) badgeNumber = normalizeBadgeNumber(badgeNumber, prefix)
    if (!badgeNumber) {
      // Exclude terminated agents so their badge numbers are treated as free
      const allRows = await prisma.agent.findMany({ where: { status: { not: 'TERMINATED' } }, select: { badgeNumber: true } })
      const blacklistedBadges = await getBlacklistedBadgeRows()
      const assigned = nextBadgeForRank(rank, allRows, prefix, null, blacklistedBadges)
      if (!assigned) return error('Keine freie Dienstnummer im Bereich des ausgewählten Rangs')
      badgeNumber = assigned.str
    }

    const allowDuplicateBadgeNumbers = await getAllowDuplicateBadgeNumbers()
    const badgeConflict = await findBadgeNumberConflict(badgeNumber, prefix, null, { allowAgentDuplicate: allowDuplicateBadgeNumbers })
    if (badgeConflict) return error(badgeConflict)
    await releaseTerminatedBadgeNumberConflicts(badgeNumber, prefix)

    const did = parsed.data.discordId ?? null
    if (did) {
      const existingDiscord = await prisma.agent.findFirst({ where: { discordId: did } })
      if (existingDiscord) return error('Discord-ID bereits vergeben')
    }

    const applicationId = parsed.data.applicationId ?? null
    if (applicationId) {
      const application = await prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, agentId: true },
      })
      if (!application) return error('Bewerbung nicht gefunden')
      if (application.agentId) return error('Diese Bewerbung ist bereits mit einem Agent verknüpft')
    }

    const unitKeys = normalizeUnitKeys(parsed.data.units ?? (parsed.data.unit ? [parsed.data.unit] : []))
    if (unitKeys.length > 0) {
      const activeUnits = await prisma.unit.findMany({ where: { key: { in: unitKeys }, active: true } })
      const activeKeys = new Set(activeUnits.map((unit) => unit.key))
      const missing = unitKeys.find((key) => !activeKeys.has(key))
      if (missing) return error('Unit nicht gefunden')
    }

    if (unitKeys.length > 0 && !hasGlobalAdministratorAccess(user)) {
      const managedUnitKeys = await getManagedUnitKeysForUser(user)
      const leadershipError = unitLeadershipChangeError([], unitKeys, managedUnitKeys)
      if (leadershipError) return error(leadershipError, 403)
    }

    const agent = await prisma.agent.create({
      data: {
        badgeNumber,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        rankId: parsed.data.rankId,
        discordId: did,
        notes: parsed.data.notes || null,
        hireDate: parsed.data.hireDate ? new Date(parsed.data.hireDate) : new Date(),
        status: parsed.data.status || 'ACTIVE',
        unit: unitKeys[0] ?? null,
        units: unitKeys,
        flag: parsed.data.flag ?? null,
      },
      include: { rank: true },
    })

    const trainings = await prisma.training.findMany({ include: { minRank: true } })
    const eligibleTrainings = eligibleTrainingsForRank(trainings, rank)
    if (eligibleTrainings.length > 0) {
      await prisma.agentTraining.createMany({
        data: eligibleTrainings.map(t => ({
          agentId: agent.id,
          trainingId: t.id,
          completed: false,
        })),
      })
    }

    await createAuditLog({
      action: 'AGENT_CREATED',
      userId: user.id,
      agentId: agent.id,
      newValue: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
    })

    if (applicationId) {
      await prisma.jobApplication.update({
        where: { id: applicationId },
        data: { agentId: agent.id },
      })
    }

    await syncLinkedUserDisplayNameForAgent(agent)
    queueAgentRoleSync(agent.id)
    queueDiscordHrEvent({
      type: 'hire',
      title: 'Neuer Beitritt',
      agent,
      actor: user,
    })

    // Arbeitsvertrag ist Pflicht: JEDER neue Mitarbeiter bekommt automatisch
    // seinen persönlichen Vertragslink per Discord-DM (mit Channel-Fallback).
    // Die Einstellung gilt erst mit unterschriebenem Vertrag als abgeschlossen —
    // deshalb gibt es hier bewusst kein Opt-out. Schlägt die Zustellung fehl,
    // wird das am Vertrag protokolliert und HR kann erneut senden.
    const contract = await queueContractForNewAgent({
      agent,
      templateId: parsed.data.contractTemplateId ?? null,
      applicationId,
      createdById: user.id,
      req,
    })

    return success({
      ...agent,
      contractId: contract?.id ?? null,
      contractCreated: Boolean(contract),
    }, 201)
  } catch (e: unknown) {
    if (isUniqueConstraintError(e)) return error('Discord-ID bereits vergeben')
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
