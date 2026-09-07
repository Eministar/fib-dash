import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import {
  getDiscordConfig,
  getDiscordGuildChannels,
  getDiscordGuildRoles,
  invalidateDiscordCache,
  managedDiscordRoleIds,
  queueAllAgentRoleSync,
  saveDiscordConfig,
} from '@/lib/discord-integration'

function discordPublicKeyConfigured() {
  return !!(process.env.DISCORD_PUBLIC_KEY?.trim() || process.env.FIB_DISCORD_PUBLIC_KEY?.trim())
}

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

function interactionEndpointUrl(req: NextRequest) {
  const requestUrl = new URL(req.url)
  const host = firstForwardedValue(req.headers.get('x-forwarded-host')) || req.headers.get('host') || requestUrl.host
  const proto = firstForwardedValue(req.headers.get('x-forwarded-proto')) || requestUrl.protocol.replace(':', '') || 'https'
  return `${proto}://${host}/api/discord/interactions`
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(['ADMIN'], ['settings:manage', 'ranks:manage', 'trainings:manage', 'units:manage'])

    const config = await getDiscordConfig()
    const [rolesResult, channelsResult, ranks, trainings, units, userGroups] = await Promise.all([
      getDiscordGuildRoles(config.guildId).then((roles) => ({ data: roles, error: null as string | null })).catch((e: unknown) => ({
        data: [],
        error: e instanceof Error ? e.message : 'Discord-Rollen konnten nicht geladen werden',
      })),
      getDiscordGuildChannels(config.guildId).then((channels) => ({ data: channels, error: null as string | null })).catch((e: unknown) => ({
        data: [],
        error: e instanceof Error ? e.message : 'Discord-Channel konnten nicht geladen werden',
      })),
      // Diese Einstellungsseite braucht nur die Bezeichner. Explizite Selects
      // verhindern, dass eine neue, noch nicht gepushte optionale Spalte die
      // komplette Discord-Konfiguration unsichtbar macht.
      prisma.rank.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.training.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { id: true, label: true },
      }),
      prisma.unit.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { key: true, name: true },
      }),
      prisma.userGroup.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ])

    return success({
      config,
      botConfigured: !!(process.env.DISCORD_BOT_TOKEN || process.env.FIB_DISCORD_BOT_TOKEN),
      roles: rolesResult.data,
      channels: channelsResult.data,
      ranks,
      trainings,
      units,
      userGroups,
      diagnostics: {
        guildConfigured: !!config.guildId,
        applicationConfigured: !!config.applicationId,
        publicKeyConfigured: discordPublicKeyConfigured(),
        interactionEndpointUrl: interactionEndpointUrl(req),
        announcementsChannelConfigured: !!config.announcementsChannelId,
        updateChannelConfigured: !!config.updateChannelId,
        sanctionsChannelConfigured: !!config.sanctionsChannelId,
        dutyAdminLogConfigured: !!config.dutyAdminLogChannelId,
        absenceStatusChannelConfigured: !!config.absenceStatusChannelId,
        rolesError: rolesResult.error,
        channelsError: channelsResult.error,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(['ADMIN'], ['settings:manage', 'ranks:manage', 'trainings:manage', 'units:manage'])
    const body = await req.json()
    const canManageSettings = hasPermission(user, 'settings:manage')
    const previousConfig = await getDiscordConfig()

    invalidateDiscordCache()
    await saveDiscordConfig({
      guildId: canManageSettings && typeof body.guildId === 'string' ? body.guildId : undefined,
      applicationId: canManageSettings && typeof body.applicationId === 'string' ? body.applicationId : undefined,
      announcementsChannelId: canManageSettings && typeof body.announcementsChannelId === 'string' ? body.announcementsChannelId : undefined,
      updateChannelId: canManageSettings && typeof body.updateChannelId === 'string' ? body.updateChannelId : undefined,
      sanctionsChannelId: canManageSettings && typeof body.sanctionsChannelId === 'string' ? body.sanctionsChannelId : undefined,
      investigationsChannelId: canManageSettings && typeof body.investigationsChannelId === 'string' ? body.investigationsChannelId : undefined,
      dutyStatusChannelId: canManageSettings && typeof body.dutyStatusChannelId === 'string' ? body.dutyStatusChannelId : undefined,
      dutyAdminLogChannelId: canManageSettings && typeof body.dutyAdminLogChannelId === 'string' ? body.dutyAdminLogChannelId : undefined,
      absenceStatusChannelId: canManageSettings && typeof body.absenceStatusChannelId === 'string' ? body.absenceStatusChannelId : undefined,
      humanResourcesRoleId: canManageSettings && typeof body.humanResourcesRoleId === 'string' ? body.humanResourcesRoleId : undefined,
      promotionBlockRoleId: canManageSettings && typeof body.promotionBlockRoleId === 'string' ? body.promotionBlockRoleId : undefined,
      employeeRoleIds: canManageSettings && Array.isArray(body.employeeRoleIds) ? body.employeeRoleIds : undefined,
      commandRoleIds: canManageSettings && Array.isArray(body.commandRoleIds) ? body.commandRoleIds : undefined,
      authLoginRoleIds: canManageSettings && Array.isArray(body.authLoginRoleIds) ? body.authLoginRoleIds : undefined,
      applicantRoleIds: canManageSettings && Array.isArray(body.applicantRoleIds) ? body.applicantRoleIds : undefined,
      adminRoleIds: canManageSettings && Array.isArray(body.adminRoleIds) ? body.adminRoleIds : undefined,
      authGroupRoleMap: canManageSettings && body.authGroupRoleMap && typeof body.authGroupRoleMap === 'object' ? body.authGroupRoleMap : undefined,
      rankRoleMap: hasPermission(user, 'ranks:manage') && body.rankRoleMap && typeof body.rankRoleMap === 'object' ? body.rankRoleMap : undefined,
      trainingRoleMap: hasPermission(user, 'trainings:manage') && body.trainingRoleMap && typeof body.trainingRoleMap === 'object' ? body.trainingRoleMap : undefined,
      // Einstellungen-Administratoren dürfen die Legacy-Zuordnung ebenfalls
      // pflegen. Zuvor wurde das Feld für Nutzer mit ausschließlich
      // `settings:manage` aus dem Payload entfernt und jede Auswahl blieb
      // dadurch wirkungslos.
      unitRoleMap: (hasPermission(user, 'units:manage') || canManageSettings) && body.unitRoleMap && typeof body.unitRoleMap === 'object' ? body.unitRoleMap : undefined,
    })
    const nextConfig = await getDiscordConfig()
    const nextManagedRoles = new Set(managedDiscordRoleIds(nextConfig))
    const staleManagedRoles = managedDiscordRoleIds(previousConfig).filter((roleId) => !nextManagedRoles.has(roleId))
    queueAllAgentRoleSync({ extraManagedRoleIds: staleManagedRoles })

    return success({ message: 'Discord-Konfiguration gespeichert' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}
