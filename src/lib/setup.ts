import 'server-only'

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@/generated/prisma/client'

const DISCORD_API = 'https://discord.com/api/v10'
const SNOWFLAKE = /^\d{17,22}$/

const DISCORD_SETTING_KEYS = {
  applicationId: 'discord.applicationId',
  guildId: 'discord.guildId',
  authLoginRoleIds: 'discord.authLoginRoleIds',
  adminRoleIds: 'discord.adminRoleIds',
  announcementsChannelId: 'discord.announcementsChannelId',
  sanctionsChannelId: 'discord.sanctionsChannelId',
} as const

type SetupDatabaseState = 'missing' | 'configured' | 'reachable' | 'unreachable'

export type SetupStatus = {
  setupRequired: boolean
  missing: string[]
  databaseState: SetupDatabaseState
  configured: {
    database: boolean
    discordBot: boolean
    discordApplication: boolean
    discordClientSecret: boolean
    discordGuild: boolean
    accessRole: boolean
  }
}

export type DiscordSetupGuild = {
  id: string
  name: string
  iconUrl: string | null
  owner?: boolean
  approximateMemberCount?: number
}

export type DiscordSetupRole = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
}

export type DiscordSetupChannel = {
  id: string
  name: string
  type: number
  position: number
}

export type DiscordSetupPreview = {
  bot: {
    id: string
    username: string
    displayName: string
    avatarUrl: string
  }
  application: {
    id: string
    name: string
    iconUrl: string | null
    publicKey: string
  }
  guilds: DiscordSetupGuild[]
  selectedGuild: DiscordSetupGuild | null
  roles: DiscordSetupRole[]
  channels: DiscordSetupChannel[]
}

export type CompleteSetupInput = {
  databaseUrl: string
  botToken: string
  clientSecret: string
  applicationId: string
  publicKey?: string
  guildId: string
  adminRoleIds: string[]
  siteUrl: string
  announcementsChannelId?: string
  sanctionsChannelId?: string
}

function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

function cleanSnowflakes(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && SNOWFLAKE.test(item))))
}

function parseStringArray(value: string | undefined) {
  if (!value) return []
  try {
    return cleanSnowflakes(JSON.parse(value))
  } catch {
    return []
  }
}

function csvSnowflakes(value: string) {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter((item) => SNOWFLAKE.test(item))))
}

function normalizeDatabaseUrl(value: string) {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Die Datenbank-URL ist ungültig.')
  }

  if (!['mysql:', 'mariadb:'].includes(parsed.protocol)) {
    throw new Error('Die Datenbank-URL muss mit mysql:// oder mariadb:// beginnen.')
  }
  if (!parsed.hostname || !parsed.pathname.replace(/^\//, '')) {
    throw new Error('Host und Datenbankname müssen in der Datenbank-URL enthalten sein.')
  }
  return trimmed
}

async function withDatabase<T>(databaseUrl: string, run: (client: PrismaClient) => Promise<T>) {
  const normalizedUrl = normalizeDatabaseUrl(databaseUrl)
  const adapter = new PrismaMariaDb(normalizedUrl)
  const client = new PrismaClient({ adapter })
  try {
    return await run(client)
  } finally {
    await client.$disconnect().catch(() => undefined)
  }
}

export async function testSetupDatabase(databaseUrl: string) {
  const startedAt = Date.now()
  const rows = await withDatabase(databaseUrl, (client) => (
    client.$queryRawUnsafe<Array<{ databaseName: string | null; version: string }>>(
      'SELECT DATABASE() AS databaseName, VERSION() AS version',
    )
  ))
  const row = rows[0]
  return {
    databaseName: row?.databaseName || new URL(databaseUrl).pathname.replace(/^\//, ''),
    version: row?.version || 'MySQL/MariaDB',
    durationMs: Date.now() - startedAt,
  }
}

async function loadStoredDiscordSetup(databaseUrl: string) {
  return withDatabase(databaseUrl, async (client) => {
    await client.$queryRawUnsafe('SELECT 1')
    try {
      const rows = await client.systemSetting.findMany({
        where: { key: { in: Object.values(DISCORD_SETTING_KEYS) } },
        select: { key: true, value: true },
      })
      return Object.fromEntries(rows.map((row) => [row.key, row.value]))
    } catch {
      // Erreichbare, aber noch leere Datenbank: Das Schema wird erst beim
      // Abschluss angelegt, daher existiert SystemSetting hier noch nicht.
      return {}
    }
  })
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const databaseUrl = env('DATABASE_URL')
  const botToken = env('DISCORD_BOT_TOKEN', 'FIB_DISCORD_BOT_TOKEN')
  const clientSecret = env('DISCORD_CLIENT_SECRET', 'FIB_DISCORD_CLIENT_SECRET')
  const envApplicationId = env(
    'DISCORD_APPLICATION_ID',
    'DISCORD_CLIENT_ID',
    'FIB_DISCORD_APPLICATION_ID',
    'FIB_DISCORD_CLIENT_ID',
  )
  const envGuildId = env('DISCORD_GUILD_ID', 'FIB_DISCORD_GUILD_ID')
  const envAccessRoles = [
    ...csvSnowflakes(env('DISCORD_AUTH_LOGIN_ROLE_IDS', 'FIB_DISCORD_AUTH_LOGIN_ROLE_IDS')),
    ...csvSnowflakes(env('DISCORD_ADMIN_ROLE_IDS', 'FIB_DISCORD_ADMIN_ROLE_IDS')),
  ]

  let databaseState: SetupDatabaseState = databaseUrl ? 'configured' : 'missing'
  let stored: Record<string, string> = {}
  let storedStateKnown = false

  if (databaseUrl && (!envApplicationId || !envGuildId || envAccessRoles.length === 0)) {
    try {
      stored = await loadStoredDiscordSetup(databaseUrl)
      databaseState = 'reachable'
      storedStateKnown = true
    } catch {
      // Eine bereits konfigurierte Installation wird bei einem vorübergehenden
      // DB-Ausfall nicht öffentlich in den Setup-Modus zurückversetzt.
      databaseState = 'unreachable'
    }
  }

  const applicationConfigured = Boolean(envApplicationId || stored[DISCORD_SETTING_KEYS.applicationId])
  const guildConfigured = Boolean(envGuildId || stored[DISCORD_SETTING_KEYS.guildId])
  const storedAccessRoles = [
    ...parseStringArray(stored[DISCORD_SETTING_KEYS.authLoginRoleIds]),
    ...parseStringArray(stored[DISCORD_SETTING_KEYS.adminRoleIds]),
  ]
  const accessConfigured = envAccessRoles.length > 0 || storedAccessRoles.length > 0

  const missing: string[] = []
  if (!databaseUrl) missing.push('database')
  if (!botToken) missing.push('discordBot')
  if (!clientSecret) missing.push('discordClientSecret')

  // Wenn die Datenbank nicht erreichbar ist, behandeln wir DB-gespeicherte
  // Discord-Werte als unbekannt statt als fehlend. Das verhindert ein
  // unbeabsichtigtes erneutes Öffnen des öffentlichen Einrichtungsmodus.
  if (!applicationConfigured && (!databaseUrl || storedStateKnown)) missing.push('discordApplication')
  if (!guildConfigured && (!databaseUrl || storedStateKnown)) missing.push('discordGuild')
  if (!accessConfigured && (!databaseUrl || storedStateKnown)) missing.push('accessRole')

  return {
    setupRequired: missing.length > 0,
    missing,
    databaseState,
    configured: {
      database: Boolean(databaseUrl),
      discordBot: Boolean(botToken),
      discordApplication: applicationConfigured,
      discordClientSecret: Boolean(clientSecret),
      discordGuild: guildConfigured,
      accessRole: accessConfigured,
    },
  }
}

async function discordJson<T>(pathname: string, token: string): Promise<T> {
  const response = await fetch(`${DISCORD_API}${pathname}`, {
    headers: { authorization: `Bot ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })

  if (!response.ok) {
    if (response.status === 401) throw new Error('Das Bot-Token wurde von Discord abgelehnt.')
    if (response.status === 403) throw new Error('Dem Bot fehlen die benötigten Discord-Berechtigungen.')
    if (response.status === 404) throw new Error('Der ausgewählte Discord-Server wurde nicht gefunden.')
    throw new Error(`Discord konnte nicht geladen werden (${response.status}).`)
  }

  return response.json() as Promise<T>
}

function discordDefaultAvatar(discordId: string) {
  const index = discordId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

export async function inspectDiscordBot(botToken: string, guildId?: string): Promise<DiscordSetupPreview> {
  const token = botToken.trim()
  if (token.length < 20) throw new Error('Bitte gib ein vollständiges Discord Bot-Token ein.')

  type BotUser = { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }
  type App = { id: string; name: string; icon?: string | null; verify_key?: string }
  type Guild = { id: string; name: string; icon?: string | null; owner?: boolean; approximate_member_count?: number }
  type Role = { id: string; name: string; color: number; position: number; managed: boolean }
  type Channel = { id: string; name?: string; type: number; position?: number }

  const [bot, application, guildRows] = await Promise.all([
    discordJson<BotUser>('/users/@me', token),
    discordJson<App>('/oauth2/applications/@me', token),
    discordJson<Guild[]>('/users/@me/guilds', token),
  ])
  if (!bot.bot) throw new Error('Dieses Token gehört nicht zu einem Discord-Bot.')

  const guilds = guildRows
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96` : null,
      owner: guild.owner,
      approximateMemberCount: guild.approximate_member_count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const selectedId = guildId?.trim() || ''
  let selectedGuild = guilds.find((guild) => guild.id === selectedId) ?? null
  let roles: DiscordSetupRole[] = []
  let channels: DiscordSetupChannel[] = []

  if (selectedId) {
    if (!SNOWFLAKE.test(selectedId)) throw new Error('Die Discord Server-ID ist ungültig.')
    const [guild, guildRoles, guildChannels] = await Promise.all([
      discordJson<Guild>(`/guilds/${selectedId}?with_counts=true`, token),
      discordJson<Role[]>(`/guilds/${selectedId}/roles`, token),
      discordJson<Channel[]>(`/guilds/${selectedId}/channels`, token),
    ])
    selectedGuild = {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96` : null,
      owner: guild.owner,
      approximateMemberCount: guild.approximate_member_count,
    }
    roles = guildRoles
      .filter((role) => role.id !== selectedId)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
      }))
      .sort((a, b) => b.position - a.position)
    channels = guildChannels
      .filter((channel) => channel.name && [0, 5].includes(channel.type))
      .map((channel) => ({ id: channel.id, name: channel.name!, type: channel.type, position: channel.position ?? 0 }))
      .sort((a, b) => a.position - b.position)
  }

  return {
    bot: {
      id: bot.id,
      username: bot.username,
      displayName: bot.global_name || bot.username,
      avatarUrl: bot.avatar
        ? `https://cdn.discordapp.com/avatars/${bot.id}/${bot.avatar}.png?size=128`
        : discordDefaultAvatar(bot.id),
    },
    application: {
      id: application.id,
      name: application.name,
      iconUrl: application.icon
        ? `https://cdn.discordapp.com/app-icons/${application.id}/${application.icon}.png?size=128`
        : null,
      publicKey: application.verify_key || '',
    },
    guilds,
    selectedGuild,
    roles,
    channels,
  }
}

function runPrismaPush(databaseUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const cliPath = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
    const child = spawn(process.execPath, [cliPath, 'db', 'push'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-12_000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Das Datenbankschema konnte nicht rechtzeitig eingerichtet werden.'))
    }, 120_000)

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(output.trim() || 'Prisma db push ist fehlgeschlagen.'))
    })
  })
}

async function persistEnvironment(values: Record<string, string>) {
  const configuredPath = process.env.FIB_SETUP_ENV_FILE?.trim()
  const filePath = configuredPath
    ? path.resolve(configuredPath)
    : path.resolve(process.cwd(), '.env.local')
  let content = ''
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`
    const expression = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=.*$`, 'm')
    content = expression.test(content)
      ? content.replace(expression, line)
      : `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 })
}

async function saveInitialDiscordSettings(input: CompleteSetupInput) {
  const roleIds = cleanSnowflakes(input.adminRoleIds)
  const settings: Record<string, string> = {
    [DISCORD_SETTING_KEYS.applicationId]: input.applicationId,
    [DISCORD_SETTING_KEYS.guildId]: input.guildId,
    [DISCORD_SETTING_KEYS.authLoginRoleIds]: JSON.stringify(roleIds),
    [DISCORD_SETTING_KEYS.adminRoleIds]: JSON.stringify(roleIds),
  }
  if (input.announcementsChannelId) {
    settings[DISCORD_SETTING_KEYS.announcementsChannelId] = input.announcementsChannelId
  }
  if (input.sanctionsChannelId) {
    settings[DISCORD_SETTING_KEYS.sanctionsChannelId] = input.sanctionsChannelId
  }

  await withDatabase(input.databaseUrl, (client) => client.$transaction(
    Object.entries(settings).map(([key, value]) => client.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })),
  ))
}

export async function completeSetup(rawInput: CompleteSetupInput) {
  const input: CompleteSetupInput = {
    ...rawInput,
    databaseUrl: normalizeDatabaseUrl(rawInput.databaseUrl),
    botToken: rawInput.botToken.trim(),
    clientSecret: rawInput.clientSecret.trim(),
    applicationId: rawInput.applicationId.trim(),
    publicKey: rawInput.publicKey?.trim(),
    guildId: rawInput.guildId.trim(),
    adminRoleIds: cleanSnowflakes(rawInput.adminRoleIds),
    siteUrl: rawInput.siteUrl.trim().replace(/\/$/, ''),
    announcementsChannelId: rawInput.announcementsChannelId?.trim(),
    sanctionsChannelId: rawInput.sanctionsChannelId?.trim(),
  }

  if (!SNOWFLAKE.test(input.applicationId)) throw new Error('Die Discord Application-ID ist ungültig.')
  if (!SNOWFLAKE.test(input.guildId)) throw new Error('Die Discord Server-ID ist ungültig.')
  if (input.adminRoleIds.length === 0) throw new Error('Wähle mindestens eine Administrator-Rolle aus.')
  if (input.clientSecret.length < 16) throw new Error('Der Discord Client Secret ist unvollständig.')
  try {
    const site = new URL(input.siteUrl)
    if (!['http:', 'https:'].includes(site.protocol)) throw new Error()
  } catch {
    throw new Error('Die öffentliche Website-URL ist ungültig.')
  }

  const [database, discord] = await Promise.all([
    testSetupDatabase(input.databaseUrl),
    inspectDiscordBot(input.botToken, input.guildId),
  ])
  if (discord.application.id !== input.applicationId) {
    throw new Error('Application-ID und Bot-Token gehören nicht zur gleichen Discord-Anwendung.')
  }
  const validRoleIds = new Set(discord.roles.map((role) => role.id))
  if (input.adminRoleIds.some((roleId) => !validRoleIds.has(roleId))) {
    throw new Error('Mindestens eine ausgewählte Administrator-Rolle existiert nicht auf diesem Server.')
  }

  await runPrismaPush(input.databaseUrl)
  await saveInitialDiscordSettings(input)

  const environment = {
    DATABASE_URL: input.databaseUrl,
    JWT_SECRET: env('JWT_SECRET') || randomBytes(48).toString('base64url'),
    NEXT_PUBLIC_SITE_URL: input.siteUrl,
    DISCORD_BOT_TOKEN: input.botToken,
    DISCORD_APPLICATION_ID: input.applicationId,
    DISCORD_CLIENT_ID: input.applicationId,
    DISCORD_CLIENT_SECRET: input.clientSecret,
    DISCORD_PUBLIC_KEY: input.publicKey || discord.application.publicKey,
    DISCORD_GUILD_ID: input.guildId,
    DISCORD_AUTH_LOGIN_ROLE_IDS: input.adminRoleIds.join(','),
    DISCORD_ADMIN_ROLE_IDS: input.adminRoleIds.join(','),
    DISCORD_ANNOUNCEMENTS_CHANNEL_ID: input.announcementsChannelId || '',
    DISCORD_SANCTIONS_CHANNEL_ID: input.sanctionsChannelId || '',
  }

  await persistEnvironment(environment)
  for (const [key, value] of Object.entries(environment)) process.env[key] = value

  return {
    database,
    bot: discord.bot,
    guild: discord.selectedGuild,
    restartRecommended: true,
  }
}
