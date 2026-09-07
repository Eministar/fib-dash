import { NextResponse } from 'next/server'
import { getSetupStatus } from '@/lib/setup'
import { runAuditLogCleanup } from '@/lib/audit-log-retention'

export const dynamic = 'force-dynamic'

type HealthCode = 'OK' | 'DEGRADED' | 'DOWN' | 'UNCONFIGURED'

type HealthCheck = {
  name: string
  code: HealthCode
  ok: boolean
  critical: boolean
  durationMs: number
  message: string
  details?: Record<string, unknown>
}

function configuredEnv(...names: string[]) {
  return names.some((name) => !!process.env[name]?.trim())
}

function httpStatus(code: HealthCode) {
  if (code === 'DOWN') return 503
  if (code === 'DEGRADED' || code === 'UNCONFIGURED') return 207
  return 200
}

async function timedCheck(
  name: string,
  critical: boolean,
  run: () => Promise<Omit<HealthCheck, 'name' | 'critical' | 'durationMs'>>,
): Promise<HealthCheck> {
  const startedAt = Date.now()
  try {
    const result = await run()
    return {
      name,
      critical,
      durationMs: Date.now() - startedAt,
      ...result,
    }
  } catch (err) {
    return {
      name,
      critical,
      code: 'DOWN',
      ok: false,
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : 'Health-Check fehlgeschlagen',
    }
  }
}

function overallCode(checks: HealthCheck[]): HealthCode {
  if (checks.some((check) => check.critical && check.code === 'DOWN')) return 'DOWN'
  if (checks.some((check) => check.code === 'DOWN' || check.code === 'DEGRADED' || check.code === 'UNCONFIGURED')) {
    return 'DEGRADED'
  }
  return 'OK'
}

async function databaseCheck() {
  const { prisma } = await import('@/lib/prisma')
  await prisma.$queryRaw`SELECT 1`
  // Health-Checks laufen typischerweise ohnehin regelmäßig und dienen damit
  // als zusätzlicher Trigger für die tägliche, markerbasierte Bereinigung.
  void runAuditLogCleanup().catch((error) => {
    console.error('[Health] Audit-Protokoll-Bereinigung fehlgeschlagen:', error)
  })
  const [users, agents] = await Promise.all([
    prisma.user.count(),
    prisma.agent.count(),
  ])

  return {
    code: 'OK' as const,
    ok: true,
    message: 'Datenbank erreichbar',
    details: { users, agents },
  }
}

async function authCheck() {
  const { getDiscordConfig } = await import('@/lib/discord-integration')
  const config = await getDiscordConfig()
  const clientConfigured = configuredEnv(
    'DISCORD_CLIENT_ID',
    'DISCORD_APPLICATION_ID',
    'FIB_DISCORD_CLIENT_ID',
    'FIB_DISCORD_APPLICATION_ID',
  ) || !!config.applicationId
  const secretConfigured = configuredEnv('DISCORD_CLIENT_SECRET', 'FIB_DISCORD_CLIENT_SECRET')
  const loginRoleCount = config.authLoginRoleIds.length
  const groupRoleCount = Object.values(config.authGroupRoleMap).flat().length

  if (!clientConfigured || !secretConfigured || !config.guildId) {
    return {
      code: 'DOWN' as const,
      ok: false,
      message: 'Discord-Login ist nicht vollständig konfiguriert',
      details: {
        clientConfigured,
        secretConfigured,
        guildConfigured: !!config.guildId,
        passwordLogin: 'disabled',
      },
    }
  }

  if (loginRoleCount === 0 && groupRoleCount === 0) {
    return {
      code: 'UNCONFIGURED' as const,
      ok: false,
      message: 'Es sind keine Login- oder Gruppen-Rollen konfiguriert',
      details: { loginRoleCount, groupRoleCount, passwordLogin: 'disabled' },
    }
  }

  return {
    code: 'OK' as const,
    ok: true,
    message: 'Discord-Login konfiguriert',
    details: { loginRoleCount, groupRoleCount, passwordLogin: 'disabled' },
  }
}

async function dutyTimesCheck() {
  const [{ getDutyTimesSnapshot }, { playerOnlineApiConfigured }] = await Promise.all([
    import('@/lib/duty-times'),
    import('@/lib/player-online'),
  ])
  const snapshot = await getDutyTimesSnapshot(new Date())
  const errorCount = snapshot.sync.errorCount
  const configured = playerOnlineApiConfigured()

  if (!configured) {
    return {
      code: 'UNCONFIGURED' as const,
      ok: false,
      message: 'Player-Online API ist nicht konfiguriert; Dienstzeiten liefern nur lokale Daten',
      details: {
        activeCount: snapshot.activeCount,
        agentCount: snapshot.rows.length,
        playerOnlineConfigured: false,
      },
    }
  }

  return {
    code: errorCount > 0 ? 'DEGRADED' as const : 'OK' as const,
    ok: errorCount === 0,
    message: errorCount > 0
      ? 'Dienstzeiten-API erreichbar, aber Player-Online Sync hat Fehler'
      : 'Dienstzeiten-API erreichbar',
    details: {
      activeCount: snapshot.activeCount,
      agentCount: snapshot.rows.length,
      playerOnlineConfigured: true,
      playerOnlineErrors: errorCount,
      checkedAt: snapshot.sync.checkedAt,
    },
  }
}

async function discordCheck() {
  const { getDiscordConfig, getDiscordGuildRoles } = await import('@/lib/discord-integration')
  const config = await getDiscordConfig()
  const botConfigured = configuredEnv('DISCORD_BOT_TOKEN', 'FIB_DISCORD_BOT_TOKEN')

  if (!botConfigured || !config.guildId) {
    return {
      code: 'DOWN' as const,
      ok: false,
      message: 'Discord Bot oder Guild-ID ist nicht konfiguriert',
      details: { botConfigured, guildConfigured: !!config.guildId },
    }
  }

  const roles = await getDiscordGuildRoles(config.guildId)
  return {
    code: roles.length > 0 ? 'OK' as const : 'DEGRADED' as const,
    ok: roles.length > 0,
    message: roles.length > 0 ? 'Discord API erreichbar' : 'Discord API erreichbar, aber keine nutzbaren Rollen gefunden',
    details: {
      guildConfigured: true,
      roleCount: roles.length,
    },
  }
}

async function discordSyncCheck() {
  const [{ prisma }, { getDiscordConfig }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/discord-integration'),
  ])
  const config = await getDiscordConfig()
  const configuredRoleIds = new Set([
    ...config.employeeRoleIds,
    ...Object.values(config.rankRoleMap),
    ...Object.values(config.trainingRoleMap),
    ...Object.values(config.unitRoleMap),
    ...config.unitGroups.flatMap((group) => [group.memberDiscordRoleId, group.leadershipDiscordRoleId]),
  ].filter(Boolean))
  const [totalAgents, linkedAgents] = await Promise.all([
    prisma.agent.count({ where: { status: { not: 'TERMINATED' } } }),
    prisma.agent.count({ where: { status: { not: 'TERMINATED' }, discordId: { not: null } } }),
  ])

  if (configuredRoleIds.size === 0) {
    return {
      code: 'UNCONFIGURED' as const,
      ok: false,
      message: 'Discord-Sync hat keine Rollen-Zuordnungen',
      details: { totalAgents, linkedAgents, syncRoleCount: 0 },
    }
  }

  return {
    code: linkedAgents > 0 ? 'OK' as const : 'DEGRADED' as const,
    ok: linkedAgents > 0,
    message: linkedAgents > 0
      ? 'Discord-Sync ist konfiguriert'
      : 'Discord-Sync ist konfiguriert, aber keine aktiven Agents haben eine Discord-ID',
    details: {
      totalAgents,
      linkedAgents,
      syncRoleCount: configuredRoleIds.size,
    },
  }
}

export async function GET() {
  const startedAt = Date.now()
  const setup = await getSetupStatus()
  if (setup.setupRequired) {
    return NextResponse.json({
      success: true,
      code: 'UNCONFIGURED',
      ok: false,
      setupRequired: true,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks: [{
        name: 'setup',
        code: 'UNCONFIGURED',
        ok: false,
        critical: false,
        durationMs: Date.now() - startedAt,
        message: 'Die Ersteinrichtung ist noch nicht abgeschlossen',
        details: { missing: setup.missing, databaseState: setup.databaseState },
      }],
    }, { status: 200 })
  }

  const checks = await Promise.all([
    timedCheck('database', true, databaseCheck),
    timedCheck('auth.login', true, authCheck),
    timedCheck('duty-times.api', false, dutyTimesCheck),
    timedCheck('discord.api', false, discordCheck),
    timedCheck('discord.sync', false, discordSyncCheck),
  ])
  const code = overallCode(checks)

  return NextResponse.json(
    {
      success: code !== 'DOWN',
      code,
      ok: code === 'OK',
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
    },
    { status: httpStatus(code) },
  )
}
