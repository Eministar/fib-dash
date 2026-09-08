import { prisma } from './prisma'
import { agentUnitKeys } from './agent-units'
import { formatDuration, getDutyTimesSnapshot } from './duty-times'
import { getActiveAbsenceNotices, runAgentStatusAutomation } from './absence-status'
import { getBadgePrefix } from './settings-helpers'
import { formatLinkedAgentDisplayName, syncLinkedUserDisplayNameForAgent } from './user-display-name'
import { queueDiscordWebhookEvent } from './discord-webhook'
import {
  actionRow,
  componentMessage,
  linkButton,
  markdownHeader,
  markdownMeta,
  markdownQuote,
  markdownRows,
  markdownTextDisplays,
} from './discord-components'

type DiscordRole = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
}

type DiscordChannel = {
  id: string
  name?: string
  type: number
}

export type DiscordApiUser = {
  id: string
  username: string
  discriminator?: string
  global_name?: string | null
  avatar?: string | null
}

export type DiscordField = {
  name: string
  value: string
  inline?: boolean
}

type DiscordTrainingChange = {
  trainingId: string
  label: string
  completed: boolean
  previousCompleted?: boolean
}

type DiscordUnitChange = {
  previous: string[]
  current: string[]
}

type DiscordGuildMember = {
  user?: DiscordApiUser
  roles?: string[]
  nick?: string | null
  avatar?: string | null
}

export type DiscordConfig = {
  hirePingRoleId: string
  hirePingChannelId: string
  bodycamViewerRoleId: string
  photoCatalogChannelId: string
  codenameBoardChannelId: string
  codenameBoardMessageIds: string[]
  guildId: string
  applicationId: string
  announcementsChannelId: string
  updateChannelId: string
  sanctionsChannelId: string
  dutyStatusChannelId: string
  dutyAdminLogChannelId: string
  /// Fallback-Channel für Vertragsnachrichten, wenn die DM nicht zustellbar ist.
  contractsChannelId: string
  /// Channel für Meldungen des Ermittlungssystems. Verschlusssachen werden
  /// grundsätzlich nicht gepostet.
  investigationsChannelId: string
  dutyStatusMessageId: string
  absenceStatusChannelId: string
  absenceStatusMessageId: string
  humanResourcesRoleId: string
  promotionBlockRoleId: string
  employeeRoleIds: string[]
  commandRoleIds: string[]
  authLoginRoleIds: string[]
  applicantRoleIds: string[]
  adminRoleIds: string[]
  /// Rollen, die JEDEN Arbeitsvertrag über dessen Link einsehen dürfen (nur lesend).
  contractAuditorRoleIds: string[]
  authGroupRoleMap: Record<string, string[]>
  rankRoleMap: Record<string, string>
  trainingRoleMap: Record<string, string>
  unitRoleMap: Record<string, string>
  unitGroups: DiscordUnitGroup[]
  /// Ebenen: eine Discord-Rolle, die Agent mit einem der zugewiesenen Ränge
  /// automatisch erhalten. Aus der DB (Tier/TierRank) geladen.
  tiers: DiscordTier[]
}

export type DiscordTier = {
  discordRoleId: string
  rankIds: string[]
}

export type DiscordUnitGroup = {
  key: string
  active: boolean
  memberDiscordRoleId: string
  leadershipDiscordRoleId: string
  unitKeys: string[]
  leadershipUnitKeys: string[]
}

type AgentForDiscord = {
  id: string
  discordId: string | null
  firstName: string
  lastName: string
  badgeNumber: string
  status: string
  promotionBlocked?: boolean | null
  units?: unknown
  unit?: string | null
  rankId: string
  rank?: { name: string; sortOrder: number; color?: string | null } | null
  trainings?: {
    trainingId: string
    completed: boolean
    training?: { id: string; label: string; sortOrder: number; minRank?: { sortOrder: number } | null } | null
  }[]
}

type UserForDiscord = {
  displayName: string
  discordId?: string | null
}

type DiscordHrEventInput = {
  type: keyof typeof EVENT_META
  title: string
  description?: string
  agent?: Pick<AgentForDiscord, 'firstName' | 'lastName' | 'badgeNumber' | 'discordId'> & {
    id?: string
    rankId?: string
    hireDate?: Date
    rank?: { name: string; color?: string | null } | null
  }
  actor?: UserForDiscord
  fields?: DiscordField[]
  trainingChanges?: DiscordTrainingChange[]
  unitChange?: DiscordUnitChange
  /** Discord-User-IDs, die durch diese Nachricht wirklich gepingt werden sollen. */
  mentionUserIds?: string[]
}

type DiscordUpdateAnnouncementInput = {
  title: string
  version?: string
  added?: string[]
  changed?: string[]
  removed?: string[]
  note?: string
  actor?: UserForDiscord
}

export type DiscordFullSyncProgress = {
  phase: 'starting' | 'checking' | 'syncing' | 'completed'
  total: number
  processed: number
  synced: number
  skipped: number
  failed: number
  current?: string
  message: string
  elapsedSeconds: number
  etaSeconds: number | null
}

export type DiscordHrEventMessage = {
  channelId: string
  messageId: string
}

const API_BASE = 'https://discord.com/api/v10'

export const DISCORD_SETTING_KEYS = {
  hirePingRoleId: 'discord.hirePingRoleId',
  hirePingChannelId: 'discord.hirePingChannelId',
  bodycamViewerRoleId: 'discord.bodycamViewerRoleId',
  photoCatalogChannelId: 'discord.photoCatalogChannelId',
  codenameBoardChannelId: 'discord.codenameBoardChannelId',
  codenameBoardMessageIds: 'discord.codenameBoardMessageIds',
  guildId: 'discord.guildId',
  applicationId: 'discord.applicationId',
  announcementsChannelId: 'discord.announcementsChannelId',
  updateChannelId: 'discord.updateChannelId',
  sanctionsChannelId: 'discord.sanctionsChannelId',
  dutyStatusChannelId: 'discord.dutyStatusChannelId',
  dutyAdminLogChannelId: 'discord.dutyAdminLogChannelId',
  contractsChannelId: 'discord.contractsChannelId',
  investigationsChannelId: 'discord.investigationsChannelId',
  dutyStatusMessageId: 'discord.dutyStatusMessageId',
  absenceStatusChannelId: 'discord.absenceStatusChannelId',
  absenceStatusMessageId: 'discord.absenceStatusMessageId',
  humanResourcesRoleId: 'discord.humanResourcesRoleId',
  promotionBlockRoleId: 'discord.promotionBlockRoleId',
  employeeRoleIds: 'discord.employeeRoleIds',
  commandRoleIds: 'discord.commandRoleIds',
  authLoginRoleIds: 'discord.authLoginRoleIds',
  applicantRoleIds: 'discord.applicantRoleIds',
  adminRoleIds: 'discord.adminRoleIds',
  contractAuditorRoleIds: 'discord.contractAuditorRoleIds',
  authGroupRoleMap: 'discord.authGroupRoleMap',
  legacyAuthRoleGroupMap: 'discord.authRoleGroupMap',
  rankRoleMap: 'discord.rankRoleMap',
  trainingRoleMap: 'discord.trainingRoleMap',
  unitRoleMap: 'discord.unitRoleMap',
} as const

const EVENT_META = {
  hire:        { icon: '✅', label: 'Neueinstellung' },
  promotion:   { icon: '🔼', label: 'Rangänderung' },
  training:    { icon: '🎓', label: 'Ausbildung aktualisiert' },
  units:       { icon: '🛡️', label: 'Unit-Zuordnung geändert' },
  sanction:    { icon: '⚠️', label: 'Sanktion ausgestellt' },
  termination: { icon: '❌', label: 'Dienstverhältnis beendet' },
  update:      { icon: '📝', label: 'Personalakte aktualisiert' },
} as const

let syncSchedulerStarted = false
let absenceExpiryCheckerStarted = false
const pendingAgentRoleSyncModes = new Map<string, 'sync' | 'remove-all'>()
const runningAgentRoleSyncs = new Set<string>()

const ABSENCE_EXPIRY_CHECK_INTERVAL_MS = Number.parseInt(
  process.env.FIB_ABSENCE_EXPIRY_CHECK_INTERVAL_MS || `${60 * 1000}`,
  10,
) || 60 * 1000

/* ── Rate-Limit Queue ────────────────────────────────────────────── */
const MAX_RETRIES = 3
const DISCORD_API_TIMEOUT_MS = Number.parseInt(process.env.DISCORD_API_TIMEOUT_MS || '30000', 10) || 30000
const TRANSIENT_FETCH_RETRY_DELAYS_MS = [1000, 3000, 7000]
let rateLimitQueue: Promise<void> = Promise.resolve()

function enqueueRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    rateLimitQueue = rateLimitQueue.then(async () => {
      try {
        resolve(await fn())
      } catch (err) {
        reject(err)
      }
    })
  })
}

/* ── In-Memory Cache für Guild-Daten ─────────────────────────────── */
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 Minuten
const MEMBER_ROLES_CACHE_TTL_MS = 30 * 60 * 1000

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const guildRolesCache = new Map<string, CacheEntry<DiscordRole[]>>()
const guildChannelsCache = new Map<string, CacheEntry<DiscordChannel[]>>()
const memberRolesCache = new Map<string, CacheEntry<string[]>>()
const guildMembersCache = new Map<string, CacheEntry<DiscordGuildMember[]>>()
const guildMembersRequests = new Map<string, Promise<DiscordGuildMember[]>>()
const memberPermissionBackoff = new Map<string, number>()
const MEMBER_PERMISSION_BACKOFF_MS = 30 * 60 * 1000
// Fehlgeschlagene Guild-Member-Abrufe werden NICHT gecacht — ohne Sperre läuft
// deshalb jeder Dashboard-Poll erneut in denselben Fehler (z. B. 403/50001 bei
// fehlendem Server-Members-Intent) und flutet Log und Discord-API.
const guildMembersBackoff = new Map<string, number>()
const GUILD_MEMBERS_BACKOFF_MS = 10 * 60 * 1000

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key)
  if (entry && Date.now() < entry.expiresAt) return entry.data
  if (entry) cache.delete(key)
  return null
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export function invalidateDiscordCache() {
  guildRolesCache.clear()
  guildChannelsCache.clear()
  memberRolesCache.clear()
  guildMembersCache.clear()
  guildMembersRequests.clear()
  memberPermissionBackoff.clear()
  guildMembersBackoff.clear()
}

function memberPermissionBlocked(memberId: string) {
  const until = memberPermissionBackoff.get(memberId) ?? 0
  if (until > Date.now()) return true
  memberPermissionBackoff.delete(memberId)
  return false
}

function blockMemberPermissions(memberId: string) {
  memberPermissionBackoff.set(memberId, Date.now() + MEMBER_PERMISSION_BACKOFF_MS)
}

/**
 * Returns a member's Discord role IDs with a short-lived cache. On a transient
 * Discord API failure the last known (stale) roles are served instead of null,
 * so an admin is never locked out by a temporary outage.
 */
async function getDiscordMemberRoleIds(discordId: string, guildId?: string): Promise<string[] | null> {
  const gid = guildId || (await getDiscordConfig()).guildId
  const id = snowflake(discordId)
  if (!gid || !id || !botToken()) return null

  const entry = memberRolesCache.get(id)
  if (entry && Date.now() < entry.expiresAt) return entry.data

  try {
    const member = await discordFetchRaw<DiscordGuildMember>(`/guilds/${gid}/members/${id}`)
    const roles = member.roles ?? []
    memberRolesCache.set(id, { data: roles, expiresAt: Date.now() + MEMBER_ROLES_CACHE_TTL_MS })
    return roles
  } catch (err) {
    console.error('[DiscordIntegration] Mitglieds-Rollen konnten nicht geladen werden:', err)
    // Serve stale cache during transient outages rather than dropping access.
    return entry ? entry.data : null
  }
}

/**
 * Determines admin status LIVE from the user's actual Discord roles (cached).
 * Independent of the dashboard group mapping, so it cannot be broken by group
 * misconfiguration and is never persisted (the periodic sync cannot strip it).
 */
export async function isDiscordUserAdmin(discordId: string | null | undefined): Promise<boolean> {
  const id = snowflake(discordId)
  if (!id) return false
  const config = await getDiscordConfig()
  if (config.adminRoleIds.length === 0) return false
  const roles = await getDiscordMemberRoleIds(id, config.guildId)
  if (!roles) return false
  const roleSet = new Set(roles)
  return config.adminRoleIds.some((roleId) => roleSet.has(roleId))
}

/**
 * Darf dieser Discord-Account JEDEN Arbeitsvertrag einsehen (nur lesend)?
 *
 * Gedacht für Aufsichts-/Prüfstellen: mit dem Vertragslink UND der passenden
 * Discord-Rolle ist jeder Vertrag einsehbar, ohne dass die Personen einen
 * Dashboard-Zugang brauchen. Die Rollen werden — wie beim Admin-Check — live
 * aus Discord gelesen, damit ein Rollenentzug sofort greift.
 */
export async function isDiscordContractAuditor(discordId: string | null | undefined): Promise<boolean> {
  const id = snowflake(discordId)
  if (!id) return false
  const config = await getDiscordConfig()
  if (config.contractAuditorRoleIds.length === 0) return false
  const roles = await getDiscordMemberRoleIds(id, config.guildId)
  if (!roles) return false
  const roleSet = new Set(roles)
  return config.contractAuditorRoleIds.some((roleId) => roleSet.has(roleId))
}

function botToken() {
  return process.env.DISCORD_BOT_TOKEN?.trim() || process.env.FIB_DISCORD_BOT_TOKEN?.trim() || ''
}

function envGuildId() {
  return process.env.DISCORD_GUILD_ID?.trim() || process.env.FIB_DISCORD_GUILD_ID?.trim() || ''
}

function envApplicationId() {
  return (
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    process.env.DISCORD_CLIENT_ID?.trim() ||
    process.env.FIB_DISCORD_APPLICATION_ID?.trim() ||
    process.env.FIB_DISCORD_CLIENT_ID?.trim() ||
    ''
  )
}

export function getDiscordApplicationId() {
  return envApplicationId()
}

export async function canCheckDiscordGuildMembers(guildId?: string) {
  const config = await getDiscordConfig()
  const id = guildId || config.guildId
  return !!id && !!botToken()
}

function envAnnouncementsChannelId() {
  return (
    process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim() ||
    process.env.DISCORD_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_CHANNEL_ID?.trim() ||
    ''
  )
}

function envSanctionsChannelId() {
  return (
    process.env.DISCORD_SANCTIONS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_SANCTIONS_CHANNEL_ID?.trim() ||
    ''
  )
}

function envUpdateChannelId() {
  return (
    process.env.DISCORD_UPDATE_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_UPDATE_CHANNEL_ID?.trim() ||
    ''
  )
}

function envDutyStatusChannelId() {
  return (
    process.env.DISCORD_DUTY_STATUS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_DUTY_STATUS_CHANNEL_ID?.trim() ||
    ''
  )
}

function envDutyAdminLogChannelId() {
  return (
    process.env.DISCORD_DUTY_ADMIN_LOG_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_DUTY_ADMIN_LOG_CHANNEL_ID?.trim() ||
    ''
  )
}

function envContractsChannelId() {
  return (
    process.env.DISCORD_CONTRACTS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_CONTRACTS_CHANNEL_ID?.trim() ||
    ''
  )
}

function envInvestigationsChannelId() {
  return (
    process.env.DISCORD_INVESTIGATIONS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_INVESTIGATIONS_CHANNEL_ID?.trim() ||
    ''
  )
}

function envAbsenceStatusChannelId() {
  return (
    process.env.DISCORD_ABSENCE_STATUS_CHANNEL_ID?.trim() ||
    process.env.FIB_DISCORD_ABSENCE_STATUS_CHANNEL_ID?.trim() ||
    ''
  )
}

function envHumanResourcesRoleId() {
  return (
    process.env.DISCORD_HUMAN_RESOURCES_ROLE_ID?.trim() ||
    process.env.FIB_DISCORD_HUMAN_RESOURCES_ROLE_ID?.trim() ||
    ''
  )
}

function envPromotionBlockRoleId() {
  return (
    process.env.DISCORD_PROMOTION_BLOCK_ROLE_ID?.trim() ||
    process.env.FIB_DISCORD_PROMOTION_BLOCK_ROLE_ID?.trim() ||
    ''
  )
}

function envAuthLoginRoleIds(): string[] {
  const raw =
    process.env.DISCORD_AUTH_LOGIN_ROLE_IDS?.trim() ||
    process.env.FIB_DISCORD_AUTH_LOGIN_ROLE_IDS?.trim() ||
    ''
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
}

function envApplicantRoleIds(): string[] {
  const raw =
    process.env.DISCORD_APPLICANT_ROLE_IDS?.trim() ||
    process.env.FIB_DISCORD_APPLICANT_ROLE_IDS?.trim() ||
    ''
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
}

function envContractAuditorRoleIds(): string[] {
  const raw =
    process.env.DISCORD_CONTRACT_AUDITOR_ROLE_IDS?.trim() ||
    process.env.FIB_DISCORD_CONTRACT_AUDITOR_ROLE_IDS?.trim() ||
    ''
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
}

function envAdminRoleIds(): string[] {
  const raw =
    process.env.DISCORD_ADMIN_ROLE_IDS?.trim() ||
    process.env.FIB_DISCORD_ADMIN_ROLE_IDS?.trim() ||
    ''
  const explicit = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  if (explicit.length > 0) return explicit
  // Legacy fallback: the removed bootstrap logic used DISCORD_AUTH_LOGIN_ROLE_IDS
  // as the admin/bootstrap roles, so honour it when no explicit admin roles exist.
  return envAuthLoginRoleIds()
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function cleanRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && /^\d{17,22}$/.test(item))))
}

function cleanRoleMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' &&
        entry[0].trim().length > 0 &&
        typeof entry[1] === 'string' &&
        /^\d{17,22}$/.test(entry[1])
      )),
  )
}

function cleanGroupRoleMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .map(([groupId, roleIds]) => {
        const cleanGroupId = typeof groupId === 'string' ? groupId.trim() : ''
        if (!cleanGroupId) return null

        const rawRoleIds = Array.isArray(roleIds) ? roleIds : [roleIds]
        const cleanRoleIds = Array.from(new Set(
          rawRoleIds.filter((roleId): roleId is string => (
            typeof roleId === 'string' && /^\d{17,22}$/.test(roleId)
          )),
        ))
        return cleanRoleIds.length > 0 ? [cleanGroupId, cleanRoleIds] as const : null
      })
      .filter((entry): entry is readonly [string, string[]] => Boolean(entry)),
  )
}

function cleanLegacyRoleGroupMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' &&
        /^\d{17,22}$/.test(entry[0]) &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0
      ))
      .map(([roleId, groupId]) => [roleId, groupId.trim()]),
  )
}

function normalizeAuthGroupRoleMap(primary: unknown, legacy: unknown): Record<string, string[]> {
  const groupRoleMap = cleanGroupRoleMap(primary)
  if (Object.keys(groupRoleMap).length > 0) return groupRoleMap

  const legacyRoleGroupMap = cleanLegacyRoleGroupMap(legacy)
  if (Object.keys(legacyRoleGroupMap).length > 0) {
    const grouped = new Map<string, string[]>()
    for (const [roleId, groupId] of Object.entries(legacyRoleGroupMap)) {
      grouped.set(groupId, [...(grouped.get(groupId) ?? []), roleId])
    }
    return Object.fromEntries(grouped)
  }
  return {}
}

function snowflake(value: string | null | undefined) {
  const id = value?.trim()
  return id && /^\d{17,22}$/.test(id) ? id : ''
}

function agentName(agent: Pick<AgentForDiscord, 'firstName' | 'lastName'>) {
  return `${agent.firstName} ${agent.lastName}`.trim()
}

function agentBadge(agent: Pick<AgentForDiscord, 'badgeNumber'>) {
  return agent.badgeNumber.trim()
}

function desiredNickname(agent: Pick<AgentForDiscord, 'firstName' | 'lastName' | 'badgeNumber'>, prefix: string) {
  const nick = formatLinkedAgentDisplayName(agent, prefix).replace(/\s+/g, ' ').trim()
  return truncate(nick, 32)
}

function mention(discordId: string | null | undefined) {
  const id = snowflake(discordId)
  return id ? `<@${id}>` : 'Nicht verknüpft'
}

export function discordUserLabel(user: UserForDiscord | null | undefined) {
  if (!user) return 'System'
  const id = snowflake(user.discordId)
  return id ? `<@${id}>` : user.displayName
}

function truncate(value: string, max = 1024) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function unixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000)
}

function discordTimestamp(date: Date, style: 'F' | 'f' | 'R' | 't' | 'D' = 'f') {
  return `<t:${unixSeconds(date)}:${style}>`
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === 'object' ? error as Record<string, unknown> : null
}

function isTransientDiscordFetchError(error: unknown) {
  const err = errorRecord(error)
  const cause = errorRecord(err?.cause)
  const name = typeof err?.name === 'string' ? err.name : ''
  const message = typeof err?.message === 'string' ? err.message : ''
  const causeName = typeof cause?.name === 'string' ? cause.name : ''
  const causeCode = typeof cause?.code === 'string' ? cause.code : ''
  const causeMessage = typeof cause?.message === 'string' ? cause.message : ''

  return (
    (name === 'TypeError' && message === 'fetch failed') ||
    name === 'TimeoutError' ||
    causeName === 'ConnectTimeoutError' ||
    causeName === 'HeadersTimeoutError' ||
    ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(causeCode) ||
    /timeout|socket|network/i.test(causeMessage)
  )
}

async function discordFetchRaw<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const token = botToken()
  if (!token) throw new Error('Discord Bot-Token fehlt')

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bot ${token}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS),
    })
  } catch (error) {
    if (attempt < MAX_RETRIES && isTransientDiscordFetchError(error)) {
      const waitMs = TRANSIENT_FETCH_RETRY_DELAYS_MS[Math.min(attempt, TRANSIENT_FETCH_RETRY_DELAYS_MS.length - 1)]
      console.warn(`[DiscordIntegration] Discord-Verbindung fehlgeschlagen auf ${path}, neuer Versuch in ${waitMs}ms (Versuch ${attempt + 1}/${MAX_RETRIES})`)
      await wait(waitMs)
      return discordFetchRaw<T>(path, init, attempt + 1)
    }
    throw error
  }

  // Rate-Limit: warten und erneut versuchen
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const body = await res.json().catch(() => ({ retry_after: 2 })) as { retry_after?: number }
    const waitMs = Math.min((body.retry_after ?? 2) * 1000, 30000)
    console.warn(`[DiscordIntegration] Rate-Limited auf ${path}, warte ${Math.round(waitMs)}ms (Versuch ${attempt + 1}/${MAX_RETRIES})`)
    await wait(waitMs + 250)
    return discordFetchRaw<T>(path, init, attempt + 1)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let code: number | undefined
    try {
      const body = JSON.parse(text) as { code?: number }
      code = body.code
    } catch {
      // Antwort ist kein JSON.
    }
    throw new DiscordApiError(res.status, code, text || res.statusText)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    details: string,
  ) {
    super(`Discord API ${status}: ${details}`)
    this.name = 'DiscordApiError'
  }
}

function isUnknownDiscordMember(error: unknown) {
  return error instanceof DiscordApiError && error.status === 404 && error.code === 10007
}

function isMissingDiscordPermissions(error: unknown) {
  return error instanceof DiscordApiError && error.status === 403 && error.code === 50013
}

async function discordFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return enqueueRateLimited(() => discordFetchRaw<T>(path, init))
}

export async function getDiscordConfig(): Promise<DiscordConfig> {
  const [rows, tierRows, unitRows, unitGroupRows] = await Promise.all([
    prisma.systemSetting.findMany({
      where: { key: { in: Object.values(DISCORD_SETTING_KEYS) } },
    }),
    prisma.tier.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, ranks: { select: { rankId: true } } },
    }),
    prisma.unit.findMany({ select: { key: true, discordRoleId: true } }),
    prisma.unitGroup.findMany({
      select: {
        key: true,
        active: true,
        memberDiscordRoleId: true,
        leadershipDiscordRoleId: true,
        units: { select: { key: true, isLeadership: true } },
      },
    }),
  ])
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]))

  const tiers: DiscordTier[] = tierRows
    .map((tier) => ({
      discordRoleId: snowflake(tier.discordRoleId),
      rankIds: tier.ranks.map((r) => r.rankId),
    }))
    .filter((tier) => tier.discordRoleId && tier.rankIds.length > 0)

  // ENV-VORRANG: In der .env gesetzte Werte gewinnen IMMER gegen die DB.
  // Scalars → env zuerst, DB nur als Fallback wenn env leer.
  // Admin-/Login-Rollen → Vereinigung: in der .env definierte Rollen sind IMMER
  // enthalten und können über DB/UI niemals entfernt werden (Break-Glass), egal
  // auf welchem Discord-Server. So sperrt man sich nach einem Serverwechsel nicht
  // mehr aus, indem die DB noch alte Rollen/Guild-IDs hält.
  const envFirst = (envValue: string, dbValue: string | undefined) => envValue || dbValue || ''
  const envLoginRoles = cleanRoleIds(envAuthLoginRoleIds())
  const envApplicantRoles = cleanRoleIds(envApplicantRoleIds())
  const envAdminRoles = cleanRoleIds(envAdminRoleIds())
  const dbLoginRoles = cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.authLoginRoleIds], []))
  const dbApplicantRoles = cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.applicantRoleIds], []))
  const dbAdminRoles = cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.adminRoleIds], []))
  const envContractAuditorRoles = cleanRoleIds(envContractAuditorRoleIds())
  const dbContractAuditorRoles = cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.contractAuditorRoleIds], []))
  const legacyUnitRoleMap = cleanRoleMap(parseJson(map[DISCORD_SETTING_KEYS.unitRoleMap], {}))
  const unitRoleMap = {
    ...legacyUnitRoleMap,
    // Nur tatsächlich gesetzte Rollen aus der Unit-Tabelle überschreiben die
    // Legacy-Zuordnung. Leere `discordRoleId`-Felder dürfen die gespeicherten
    // Rollen aus `discord.unitRoleMap` nicht in leere Strings verwandeln —
    // genau dadurch erschienen in den Einstellungen bisher alle Einträge als
    // „Keine Rolle“ und waren nach dem Speichern wieder verschwunden.
    ...Object.fromEntries(
      unitRows
        .filter((unit) => typeof unit.discordRoleId === 'string' && /^\d{17,22}$/.test(unit.discordRoleId))
        .map((unit) => [
          unit.key,
          unit.discordRoleId!,
        ]),
    ),
  }
  const unitGroups: DiscordUnitGroup[] = unitGroupRows.map((group) => ({
    key: group.key,
    active: group.active,
    memberDiscordRoleId: snowflake(group.memberDiscordRoleId),
    leadershipDiscordRoleId: snowflake(group.leadershipDiscordRoleId),
    unitKeys: group.units.map((unit) => unit.key),
    leadershipUnitKeys: group.units.filter((unit) => unit.isLeadership).map((unit) => unit.key),
  }))

  return {
    guildId: envFirst(envGuildId(), map[DISCORD_SETTING_KEYS.guildId]),
    applicationId: envFirst(envApplicationId(), map[DISCORD_SETTING_KEYS.applicationId]),
    announcementsChannelId: envFirst(envAnnouncementsChannelId(), map[DISCORD_SETTING_KEYS.announcementsChannelId]),
    updateChannelId: envFirst(envUpdateChannelId(), map[DISCORD_SETTING_KEYS.updateChannelId]),
    sanctionsChannelId: envFirst(envSanctionsChannelId(), map[DISCORD_SETTING_KEYS.sanctionsChannelId]),
    dutyStatusChannelId: envFirst(envDutyStatusChannelId(), map[DISCORD_SETTING_KEYS.dutyStatusChannelId]),
    dutyAdminLogChannelId: envFirst(envDutyAdminLogChannelId(), map[DISCORD_SETTING_KEYS.dutyAdminLogChannelId]),
    contractsChannelId: envFirst(envContractsChannelId(), map[DISCORD_SETTING_KEYS.contractsChannelId]),
    investigationsChannelId: envFirst(
      envInvestigationsChannelId(),
      map[DISCORD_SETTING_KEYS.investigationsChannelId],
    ),
    bodycamViewerRoleId: envFirst(process.env.DISCORD_BODYCAM_VIEWER_ROLE_ID?.trim() || '', map[DISCORD_SETTING_KEYS.bodycamViewerRoleId]),
    hirePingRoleId: envFirst(process.env.DISCORD_HIRE_PING_ROLE_ID?.trim() || '', map[DISCORD_SETTING_KEYS.hirePingRoleId]),
    hirePingChannelId: envFirst(process.env.DISCORD_HIRE_PING_CHANNEL_ID?.trim() || '', map[DISCORD_SETTING_KEYS.hirePingChannelId]),
    photoCatalogChannelId: envFirst(process.env.DISCORD_PHOTO_CATALOG_CHANNEL_ID?.trim() || '', map[DISCORD_SETTING_KEYS.photoCatalogChannelId]),
    codenameBoardChannelId: envFirst(process.env.DISCORD_CODENAME_BOARD_CHANNEL_ID?.trim() || '', map[DISCORD_SETTING_KEYS.codenameBoardChannelId]),
    codenameBoardMessageIds: cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.codenameBoardMessageIds], [])),
    dutyStatusMessageId: map[DISCORD_SETTING_KEYS.dutyStatusMessageId] || '',
    absenceStatusChannelId: envFirst(envAbsenceStatusChannelId(), map[DISCORD_SETTING_KEYS.absenceStatusChannelId]),
    absenceStatusMessageId: map[DISCORD_SETTING_KEYS.absenceStatusMessageId] || '',
    humanResourcesRoleId: envFirst(envHumanResourcesRoleId(), map[DISCORD_SETTING_KEYS.humanResourcesRoleId]),
    promotionBlockRoleId: envFirst(envPromotionBlockRoleId(), map[DISCORD_SETTING_KEYS.promotionBlockRoleId]),
    employeeRoleIds: cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.employeeRoleIds], [])),
    commandRoleIds: cleanRoleIds(parseJson(map[DISCORD_SETTING_KEYS.commandRoleIds], [])),
    authLoginRoleIds: Array.from(new Set([...envLoginRoles, ...dbLoginRoles])),
    applicantRoleIds: Array.from(new Set([...envApplicantRoles, ...dbApplicantRoles])),
    adminRoleIds: Array.from(new Set([...envAdminRoles, ...dbAdminRoles])),
    contractAuditorRoleIds: Array.from(new Set([...envContractAuditorRoles, ...dbContractAuditorRoles])),
    authGroupRoleMap: normalizeAuthGroupRoleMap(
      parseJson(map[DISCORD_SETTING_KEYS.authGroupRoleMap], {}),
      parseJson(map[DISCORD_SETTING_KEYS.legacyAuthRoleGroupMap], {}),
    ),
    rankRoleMap: cleanRoleMap(parseJson(map[DISCORD_SETTING_KEYS.rankRoleMap], {})),
    trainingRoleMap: cleanRoleMap(parseJson(map[DISCORD_SETTING_KEYS.trainingRoleMap], {})),
    unitRoleMap,
    unitGroups,
    tiers,
  }
}

export async function saveDiscordConfig(input: Partial<DiscordConfig>) {
  const data: Record<string, string> = {}

  if (input.codenameBoardChannelId !== undefined) data[DISCORD_SETTING_KEYS.codenameBoardChannelId] = input.codenameBoardChannelId.trim()
  if (input.photoCatalogChannelId !== undefined) data[DISCORD_SETTING_KEYS.photoCatalogChannelId] = input.photoCatalogChannelId.trim()
  if (input.bodycamViewerRoleId !== undefined) data[DISCORD_SETTING_KEYS.bodycamViewerRoleId] = input.bodycamViewerRoleId.trim()
  if (input.hirePingRoleId !== undefined) data[DISCORD_SETTING_KEYS.hirePingRoleId] = input.hirePingRoleId.trim()
  if (input.hirePingChannelId !== undefined) data[DISCORD_SETTING_KEYS.hirePingChannelId] = input.hirePingChannelId.trim()
  if (input.codenameBoardMessageIds !== undefined) data[DISCORD_SETTING_KEYS.codenameBoardMessageIds] = JSON.stringify(cleanRoleIds(input.codenameBoardMessageIds))
  if (input.guildId !== undefined) data[DISCORD_SETTING_KEYS.guildId] = input.guildId.trim()
  if (input.applicationId !== undefined) data[DISCORD_SETTING_KEYS.applicationId] = input.applicationId.trim()
  if (input.announcementsChannelId !== undefined) data[DISCORD_SETTING_KEYS.announcementsChannelId] = input.announcementsChannelId.trim()
  if (input.updateChannelId !== undefined) data[DISCORD_SETTING_KEYS.updateChannelId] = input.updateChannelId.trim()
  if (input.sanctionsChannelId !== undefined) data[DISCORD_SETTING_KEYS.sanctionsChannelId] = input.sanctionsChannelId.trim()
  if (input.dutyStatusChannelId !== undefined) data[DISCORD_SETTING_KEYS.dutyStatusChannelId] = input.dutyStatusChannelId.trim()
  if (input.dutyAdminLogChannelId !== undefined) data[DISCORD_SETTING_KEYS.dutyAdminLogChannelId] = input.dutyAdminLogChannelId.trim()
  if (input.contractsChannelId !== undefined) data[DISCORD_SETTING_KEYS.contractsChannelId] = input.contractsChannelId.trim()
  if (input.investigationsChannelId !== undefined) data[DISCORD_SETTING_KEYS.investigationsChannelId] = input.investigationsChannelId.trim()
  if (input.dutyStatusMessageId !== undefined) data[DISCORD_SETTING_KEYS.dutyStatusMessageId] = input.dutyStatusMessageId.trim()
  if (input.absenceStatusChannelId !== undefined) data[DISCORD_SETTING_KEYS.absenceStatusChannelId] = input.absenceStatusChannelId.trim()
  if (input.absenceStatusMessageId !== undefined) data[DISCORD_SETTING_KEYS.absenceStatusMessageId] = input.absenceStatusMessageId.trim()
  if (input.humanResourcesRoleId !== undefined) data[DISCORD_SETTING_KEYS.humanResourcesRoleId] = input.humanResourcesRoleId.trim()
  if (input.promotionBlockRoleId !== undefined) data[DISCORD_SETTING_KEYS.promotionBlockRoleId] = input.promotionBlockRoleId.trim()
  if (input.employeeRoleIds !== undefined) data[DISCORD_SETTING_KEYS.employeeRoleIds] = JSON.stringify(cleanRoleIds(input.employeeRoleIds))
  if (input.commandRoleIds !== undefined) data[DISCORD_SETTING_KEYS.commandRoleIds] = JSON.stringify(cleanRoleIds(input.commandRoleIds))
  if (input.authLoginRoleIds !== undefined) data[DISCORD_SETTING_KEYS.authLoginRoleIds] = JSON.stringify(cleanRoleIds(input.authLoginRoleIds))
  if (input.applicantRoleIds !== undefined) data[DISCORD_SETTING_KEYS.applicantRoleIds] = JSON.stringify(cleanRoleIds(input.applicantRoleIds))
  if (input.adminRoleIds !== undefined) data[DISCORD_SETTING_KEYS.adminRoleIds] = JSON.stringify(cleanRoleIds(input.adminRoleIds))
  if (input.contractAuditorRoleIds !== undefined) data[DISCORD_SETTING_KEYS.contractAuditorRoleIds] = JSON.stringify(cleanRoleIds(input.contractAuditorRoleIds))
  if (input.authGroupRoleMap !== undefined) data[DISCORD_SETTING_KEYS.authGroupRoleMap] = JSON.stringify(cleanGroupRoleMap(input.authGroupRoleMap))
  if (input.rankRoleMap !== undefined) data[DISCORD_SETTING_KEYS.rankRoleMap] = JSON.stringify(cleanRoleMap(input.rankRoleMap))
  if (input.trainingRoleMap !== undefined) data[DISCORD_SETTING_KEYS.trainingRoleMap] = JSON.stringify(cleanRoleMap(input.trainingRoleMap))
  if (input.unitRoleMap !== undefined) data[DISCORD_SETTING_KEYS.unitRoleMap] = JSON.stringify(cleanRoleMap(input.unitRoleMap))

  const entries = Object.entries(data)
  if (entries.length === 0) return

  await prisma.$transaction(
    entries.map(([key, value]) => (
      prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    )),
  )
}

export async function getDiscordGuildRoles(guildId?: string) {
  const config = await getDiscordConfig()
  const id = guildId || config.guildId
  if (!id || !botToken()) return []

  const cached = getCached(guildRolesCache, id)
  if (cached) return cached

  const roles = await discordFetch<DiscordRole[]>(`/guilds/${id}/roles`)
  const seenIds = new Set<string>()

  const result = roles
    .filter((role) => !role.managed && role.name !== '@everyone')
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
    .filter((role) => {
      if (seenIds.has(role.id)) return false
      seenIds.add(role.id)
      return true
    })

  setCache(guildRolesCache, id, result)
  return result
}

export async function getDiscordGuildChannels(guildId?: string) {
  const config = await getDiscordConfig()
  const id = guildId || config.guildId
  if (!id || !botToken()) return []

  const cached = getCached(guildChannelsCache, id)
  if (cached) return cached

  const channels = await discordFetch<DiscordChannel[]>(`/guilds/${id}/channels`)
  const result = channels
    .filter((channel) => channel.type === 0 || channel.type === 5 || channel.type === 15)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  setCache(guildChannelsCache, id, result)
  return result
}

export async function getDiscordGuildMember(discordId: string, guildId?: string) {
  const config = await getDiscordConfig()
  const id = guildId || config.guildId
  const memberId = snowflake(discordId)
  if (!id || !memberId || !botToken()) return null

  return discordFetchRaw<DiscordGuildMember>(`/guilds/${id}/members/${memberId}`).catch(() => null)
}

export async function getDiscordGuildMembers(guildId?: string) {
  const config = await getDiscordConfig()
  const id = guildId || config.guildId
  if (!id || !botToken()) return []

  const cached = getCached(guildMembersCache, id)
  if (cached) return cached

  // Nach einem Fehlschlag für eine Weile gar nicht erst anfragen.
  if (Date.now() < (guildMembersBackoff.get(id) ?? 0)) return []

  const existingRequest = guildMembersRequests.get(id)
  if (existingRequest) return existingRequest

  const request = (async () => {
    const members: DiscordGuildMember[] = []
    let after = '0'

    try {
      while (true) {
        const page = await discordFetchRaw<DiscordGuildMember[]>(`/guilds/${id}/members?limit=1000&after=${after}`)
        if (page.length === 0) break
        members.push(...page)
        const lastId = page[page.length - 1]?.user?.id
        if (!lastId || page.length < 1000) break
        after = lastId
      }
    } catch (error) {
      // Bewusst kein Rethrow: der Abruf ist für alle Aufrufer optional und ein
      // Fehler darf weder den Request killen noch bei jedem Poll neu auflaufen.
      guildMembersBackoff.set(id, Date.now() + GUILD_MEMBERS_BACKOFF_MS)
      logGuildMembersFailure(id, error)
      return []
    }

    guildMembersBackoff.delete(id)
    setCache(guildMembersCache, id, members)
    return members
  })().finally(() => {
    guildMembersRequests.delete(id)
  })

  guildMembersRequests.set(id, request)
  return request
}

/**
 * Loggt einen fehlgeschlagenen Guild-Member-Abruf genau einmal pro Backoff-
 * Fenster. Bei 403/50001 fehlt praktisch immer der privilegierte Intent —
 * Server-Rollenrechte des Bots ändern daran nichts, deshalb der explizite Hinweis.
 */
function logGuildMembersFailure(guildId: string, error: unknown) {
  const minutes = Math.round(GUILD_MEMBERS_BACKOFF_MS / 60000)
  if (error instanceof DiscordApiError && error.status === 403 && error.code === 50001) {
    console.error(
      `[DiscordIntegration] Mitgliederliste für Guild ${guildId} nicht abrufbar (403 Missing Access). ` +
      'Ursache ist fast immer der fehlende "Server Members Intent": Discord Developer Portal → ' +
      'Applications → Bot → Privileged Gateway Intents → SERVER MEMBERS INTENT aktivieren. ' +
      `Prüfe sonst, ob DISCORD_GUILD_ID stimmt und der Bot auf diesem Server ist. Nächster Versuch in ${minutes} Minuten.`,
    )
    return
  }
  console.error(
    `[DiscordIntegration] Mitgliederliste für Guild ${guildId} nicht abrufbar. Nächster Versuch in ${minutes} Minuten:`,
    error,
  )
}

export function getCachedDiscordGuildMembers(guildId: string) {
  return getCached(guildMembersCache, guildId)
}

export function refreshDiscordGuildMembers(guildId: string) {
  if (!guildId || !botToken() || guildMembersRequests.has(guildId)) return
  // Fehler werden bereits in getDiscordGuildMembers einmal pro Backoff-Fenster
  // geloggt — hier nur noch abfangen, damit kein unhandled rejection entsteht.
  void getDiscordGuildMembers(guildId).catch(() => {})
}

async function getAgentForDiscord(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      rank: true,
      trainings: { include: { training: { include: { minRank: true } } } },
    },
  })
}

export function managedDiscordRoleIds(config: DiscordConfig, extraManagedRoleIds: string[] = []) {
  return Array.from(new Set([
    ...config.employeeRoleIds,
    ...Object.values(config.rankRoleMap),
    ...Object.values(config.trainingRoleMap),
    ...Object.values(config.unitRoleMap),
    ...config.unitGroups.flatMap((group) => [group.memberDiscordRoleId, group.leadershipDiscordRoleId]),
    ...config.tiers.map((tier) => tier.discordRoleId),
    config.promotionBlockRoleId,
    ...extraManagedRoleIds,
  ].filter(Boolean)))
}

function dashboardGroupIdsForRoles(roleIds: string[], config: DiscordConfig) {
  const roles = new Set(roleIds)
  return Array.from(new Set(
    Object.entries(config.authGroupRoleMap)
      .filter(([, groupRoleIds]) => groupRoleIds.some((roleId) => roles.has(roleId)))
      .map(([groupId]) => groupId)
      .filter(Boolean),
  ))
}

function desiredRoleIds(agent: AgentForDiscord, config: DiscordConfig) {
  if (agent.status === 'TERMINATED') return []

  const assignedUnitKeys = agentUnitKeys(agent)
  const assignedUnitSet = new Set(assignedUnitKeys)
  const unitGroupRoles = config.unitGroups
    .filter((group) => group.active && group.unitKeys.some((unitKey) => assignedUnitSet.has(unitKey)))
    .flatMap((group) => [
      group.memberDiscordRoleId,
      group.leadershipUnitKeys.some((unitKey) => assignedUnitSet.has(unitKey))
        ? group.leadershipDiscordRoleId
        : '',
    ])

  return Array.from(new Set([
    ...config.employeeRoleIds,
    config.rankRoleMap[agent.rankId],
    ...assignedUnitKeys.map((unitKey) => config.unitRoleMap[unitKey]),
    ...unitGroupRoles,
    ...(agent.trainings ?? [])
      .filter((training) => training.completed)
      .map((training) => config.trainingRoleMap[training.trainingId]),
    // Ebenen: Rolle vergeben, wenn der Rang des Agents einer Ebene zugewiesen ist.
    ...config.tiers
      .filter((tier) => tier.rankIds.includes(agent.rankId))
      .map((tier) => tier.discordRoleId),
    ...(agent.promotionBlocked ? [config.promotionBlockRoleId] : []),
  ].filter((roleId): roleId is string => !!roleId)))
}

async function fetchGuildMember(
  config: DiscordConfig,
  discordId: string | null | undefined,
): Promise<DiscordGuildMember | null> {
  const memberId = snowflake(discordId)
  if (!config.guildId || !memberId || !botToken()) return null
  return discordFetchRaw<DiscordGuildMember>(`/guilds/${config.guildId}/members/${memberId}`).catch(() => null)
}

async function syncAgentDashboardGroupsForAgent(
  agent: AgentForDiscord,
  config: DiscordConfig,
  mode: 'sync' | 'remove-all' = 'sync',
  memberRoles?: string[] | null,
) {
  if (!agent?.discordId) return

  const user = await prisma.user.findFirst({
    where: { discordId: agent.discordId },
    select: {
      id: true,
      groupMemberships: { select: { groupId: true, source: true } },
    },
  })
  if (!user) return

  // Robustness: Discord-derived dashboard groups (incl. admin/login roles) MUST be
  // computed from the member's ACTUAL Discord roles — exactly like the login flow
  // (matchingGroupIds). Deriving them from the agent's rank/unit/training roles
  // alone silently strips any group mapped to a non-rank role (e.g. an "Admin"
  // role) on every periodic sync, so the user loses permissions over time.
  let desiredDiscordGroupIds: string[]
  if (mode === 'remove-all') {
    desiredDiscordGroupIds = []
  } else {
    if (!memberRoles) {
      // Actual Discord roles are unknown (no bot token or fetch failed). Do NOT
      // touch Discord-sourced memberships — preserving them avoids revoking
      // permissions on transient Discord API failures.
      return
    }
    // Union of the member's real Discord roles and the agent's intended roles,
    // so the dashboard reflects both auth roles (admin) and rank-based grants.
    const effectiveRoles = Array.from(new Set([...memberRoles, ...desiredRoleIds(agent, config)]))
    desiredDiscordGroupIds = dashboardGroupIdsForRoles(effectiveRoles, config)
  }

  // Keep manual memberships, only replace Discord-sourced ones
  const manualGroupIds = user.groupMemberships
    .filter((m) => m.source === 'manual')
    .map((m) => m.groupId)

  const allGroupIds = Array.from(new Set([...manualGroupIds, ...desiredDiscordGroupIds]))
  const existingGroups = allGroupIds.length > 0
    ? await prisma.userGroup.findMany({ where: { id: { in: allGroupIds } }, select: { id: true } })
    : []
  const existingGroupIds = new Set(existingGroups.map((group) => group.id))
  const validDiscordGroupIds = desiredDiscordGroupIds.filter((id) => existingGroupIds.has(id))
  const validManualGroupIds = manualGroupIds.filter((id) => existingGroupIds.has(id))
  const primaryGroupId = validManualGroupIds[0] ?? validDiscordGroupIds[0] ?? null

  await prisma.$transaction([
    // Only replace Discord-synced memberships, never touch manual assignments
    prisma.userGroupMembership.deleteMany({ where: { userId: user.id, source: 'discord' } }),
    ...(validDiscordGroupIds.length > 0
      ? [prisma.userGroupMembership.createMany({
          data: validDiscordGroupIds.map((groupId) => ({ userId: user.id, groupId, source: 'discord' })),
          skipDuplicates: true,
        })]
      : []),
    // Update primary group only — NEVER clear direct permissions here
    prisma.user.update({
      where: { id: user.id },
      data: { groupId: primaryGroupId },
    }),
  ])
}

export async function syncAgentDashboardGroups(agentId: string, mode: 'sync' | 'remove-all' = 'sync') {
  const config = await getDiscordConfig()
  const agent = await getAgentForDiscord(agentId)
  if (!agent) return

  const member = mode === 'remove-all' ? null : await fetchGuildMember(config, agent.discordId)
  await syncAgentDashboardGroupsForAgent(agent, config, mode, member?.roles ?? null)
}

async function syncAgentDiscordMember(
  agent: AgentForDiscord,
  config: DiscordConfig,
  mode: 'sync' | 'remove-all' = 'sync',
  preloadedMember?: DiscordGuildMember | null,
  extraManagedRoleIds: string[] = [],
) {
  if (!agent?.discordId) return

  const memberId = snowflake(agent.discordId)
  if (!memberId) return
  if (memberPermissionBlocked(memberId)) return { status: 'missing-permissions' as const }

  const allManaged = Array.from(new Set([
    ...managedDiscordRoleIds(config, extraManagedRoleIds),
    ...config.applicantRoleIds,
  ]))
  const desired = mode === 'remove-all' ? [] : desiredRoleIds(agent, config)
  // Reuse a member already fetched by the caller (undefined = not provided → fetch)
  const member = preloadedMember !== undefined
    ? preloadedMember
    : await discordFetchRaw<DiscordGuildMember>(`/guilds/${config.guildId}/members/${memberId}`).catch(() => null)
  if (!member) return { status: 'not-member' as const }

  const currentRoles = new Set(member?.roles ?? [])
  const desiredSet = new Set(desired)
  const toAdd = desired.filter((roleId) => !currentRoles.has(roleId))
  const toRemove = allManaged.filter((roleId) => currentRoles.has(roleId) && !desiredSet.has(roleId))

  // Rollen sequentiell verarbeiten um Rate-Limits zu vermeiden
  for (const roleId of toRemove) {
    try {
      await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}/roles/${roleId}`, { method: 'DELETE' })
    } catch (err) {
      if (isUnknownDiscordMember(err)) return { status: 'not-member' as const }
      if (isMissingDiscordPermissions(err)) {
        blockMemberPermissions(memberId)
        console.warn(`[DiscordIntegration] Rollen-Sync für ${memberId} übersprungen: Bot-Rolle ist nicht hoch genug.`)
        return { status: 'missing-permissions' as const }
      }
      console.error('[DiscordIntegration] Rolle entfernen fehlgeschlagen:', err)
    }
  }
  for (const roleId of toAdd) {
    try {
      await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}/roles/${roleId}`, { method: 'PUT' })
    } catch (err) {
      if (isUnknownDiscordMember(err)) return { status: 'not-member' as const }
      if (isMissingDiscordPermissions(err)) {
        blockMemberPermissions(memberId)
        console.warn(`[DiscordIntegration] Rollen-Sync für ${memberId} übersprungen: Bot-Rolle ist nicht hoch genug.`)
        return { status: 'missing-permissions' as const }
      }
      console.error('[DiscordIntegration] Rolle hinzufügen fehlgeschlagen:', err)
    }
  }

  if (mode === 'remove-all' && member?.nick !== null) {
    await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ nick: null }),
    }).catch((error) => {
      if (!isUnknownDiscordMember(error) && !isMissingDiscordPermissions(error)) {
        console.error('[DiscordIntegration] Nickname-Entfernung fehlgeschlagen:', error)
      }
    })
  }

  if (mode === 'sync' && agent.status !== 'TERMINATED') {
    const nick = desiredNickname(agent, await getBadgePrefix())
    if (member?.nick !== nick) {
      await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nick }),
      }).catch((error) => {
      if (isMissingDiscordPermissions(error)) {
          blockMemberPermissions(memberId)
          console.warn(`[DiscordIntegration] Nickname-Sync für ${memberId} übersprungen: Rollen-Hierarchie oder Serverinhaber.`)
        } else if (!isUnknownDiscordMember(error)) {
          console.error('[DiscordIntegration] Nickname-Sync fehlgeschlagen:', error)
        }
      })
    }
  }
  return { status: 'synced' as const }
}

/**
 * Setzt den Server-Nickname eines Mitglieds — genutzt, wenn ein Bewerber auf
 * „Aktenzeichen | Name“ umbenannt wird. Fehler werden bewusst nur protokolliert:
 * eine zu niedrige Bot-Rolle darf die Bewerbung nicht scheitern lassen.
 */
export async function setDiscordMemberNickname(discordId: string | null | undefined, nickname: string) {
  const config = await getDiscordConfig()
  if (!config.guildId || !botToken()) return { status: 'skipped' as const }

  const memberId = snowflake(discordId)
  if (!memberId) return { status: 'skipped' as const }
  if (memberPermissionBlocked(memberId)) return { status: 'missing-permissions' as const }

  const nick = truncate(nickname.replace(/\s+/g, ' ').trim(), 32)
  if (!nick) return { status: 'skipped' as const }

  try {
    await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ nick }),
    })
    return { status: 'synced' as const }
  } catch (err) {
    if (isMissingDiscordPermissions(err)) {
      blockMemberPermissions(memberId)
      console.warn(`[DiscordIntegration] Nickname für ${memberId} nicht gesetzt: Rollen-Hierarchie oder Serverinhaber.`)
      return { status: 'missing-permissions' as const }
    }
    if (isUnknownDiscordMember(err)) return { status: 'not-member' as const }
    console.error('[DiscordIntegration] Nickname setzen fehlgeschlagen:', err)
    return { status: 'failed' as const }
  }
}

export async function addDiscordRoleToMember(discordId: string, roleId: string) {
  const config = await getDiscordConfig()
  if (!config.guildId || !botToken()) return
  const memberId = snowflake(discordId)
  const rId = snowflake(roleId)
  if (!memberId || !rId) return
  await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}/roles/${rId}`, { method: 'PUT' }).catch((err) => {
    console.error('[DiscordIntegration] Rolle hinzufügen fehlgeschlagen:', err)
  })
}

export async function removeDiscordRoleFromMember(discordId: string, roleId: string) {
  const config = await getDiscordConfig()
  if (!config.guildId || !botToken()) return
  const memberId = snowflake(discordId)
  const rId = snowflake(roleId)
  if (!memberId || !rId) return
  await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}/roles/${rId}`, { method: 'DELETE' }).catch((err) => {
    console.error('[DiscordIntegration] Rolle entfernen fehlgeschlagen:', err)
  })
}

export async function syncAgentDiscordRoles(agentId: string, mode: 'sync' | 'remove-all' = 'sync') {
  const config = await getDiscordConfig()
  const agent = await getAgentForDiscord(agentId)
  if (!agent) return
  if (mode === 'sync') await syncLinkedUserDisplayNameForAgent(agent)

  // Fetch the member once and share it between group- and role-sync to avoid
  // double Discord calls and to derive dashboard groups from actual roles.
  const member = mode === 'remove-all' ? null : await fetchGuildMember(config, agent.discordId)

  await syncAgentDashboardGroupsForAgent(agent, config, mode, member?.roles ?? null)

  if (!config.guildId || !botToken()) return
  if (mode === 'sync' && !member) return

  await syncAgentDiscordMember(agent, config, mode, mode === 'remove-all' ? undefined : member)
}

export async function syncFormerAgentDiscordMember(agent: AgentForDiscord) {
  const config = await getDiscordConfig()
  await syncAgentDashboardGroupsForAgent(agent, config, 'remove-all')

  if (!config.guildId || !botToken()) return

  await syncAgentDiscordMember(agent, config, 'remove-all')
}

export async function syncAllAgentDiscordRoles(options?: {
  onProgress?: (progress: DiscordFullSyncProgress) => void | Promise<void>
  extraManagedRoleIds?: string[]
}) {
  const config = await getDiscordConfig()

  const agents = await prisma.agent.findMany({
    include: {
      rank: true,
      trainings: { include: { training: { include: { minRank: true } } } },
    },
    orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
  })

  let synced = 0
  let skipped = 0
  let failed = 0
  const canSyncDiscord = !!config.guildId && !!botToken()
  const startedAt = Date.now()

  const emitProgress = async (
    phase: DiscordFullSyncProgress['phase'],
    current?: string,
    message?: string,
  ) => {
    const processed = synced + skipped + failed
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    const etaSeconds = processed > 0 && processed < agents.length
      ? Math.max(0, Math.round((elapsedSeconds / processed) * (agents.length - processed)))
      : null

    await options?.onProgress?.({
      phase,
      total: agents.length,
      processed,
      synced,
      skipped,
      failed,
      current,
      message: message ?? 'Synchronisiere Agents',
      elapsedSeconds,
      etaSeconds,
    })
  }

  await emitProgress('starting', undefined, 'Lade Agents und Discord-Konfiguration')

  // Agents sequentiell verarbeiten (1 pro Batch) um Rate-Limits zu vermeiden
  for (const agent of agents) {
    const agentLabel = `${agent.firstName} ${agent.lastName} #${agent.badgeNumber}`
    await emitProgress('checking', agentLabel, `Prüfe ${agentLabel}`)
    await syncLinkedUserDisplayNameForAgent(agent)

    if (!agent.discordId) {
      skipped++
      await emitProgress('syncing', agentLabel, `Übersprungen: ${agentLabel} hat keine Discord-ID`)
      continue
    }
    try {
      const mode = agent.status === 'TERMINATED' ? 'remove-all' : 'sync'
      await emitProgress('syncing', agentLabel, `Synchronisiere Gruppen und Rollen für ${agentLabel}`)

      // Fetch the member once per agent; reuse for both group and role sync.
      const member = canSyncDiscord && mode === 'sync'
        ? await fetchGuildMember(config, agent.discordId)
        : null

      if (canSyncDiscord && mode === 'sync' && !member) {
        skipped++
        await emitProgress('syncing', agentLabel, `Übersprungen: ${agentLabel} ist nicht auf dem Discord-Server`)
        continue
      }

      await syncAgentDashboardGroupsForAgent(agent, config, mode, member?.roles ?? null)
      if (canSyncDiscord) {
        await syncAgentDiscordMember(
          agent,
          config,
          mode,
          mode === 'remove-all' ? undefined : member,
          options?.extraManagedRoleIds,
        )
      }
      synced++
      await emitProgress('syncing', agentLabel, `Fertig: ${agentLabel}`)
    } catch (err) {
      failed++
      console.error(`[DiscordIntegration] Sync fehlgeschlagen für Agent ${agent.badgeNumber}:`, err)
      await emitProgress('syncing', agentLabel, `Fehlgeschlagen: ${agentLabel}`)
    }
  }

  if (canSyncDiscord) {
    await emitProgress('syncing', undefined, 'Räume verwaiste Discord-Rollen auf')
    const activeAgentDiscordIds = new Set(
      agents
        .filter((agent) => agent.status !== 'TERMINATED')
        .map((agent) => snowflake(agent.discordId))
        .filter((discordId): discordId is string => Boolean(discordId)),
    )
    const managedRoleSet = new Set(managedDiscordRoleIds(config, options?.extraManagedRoleIds))
    const members = await getDiscordGuildMembers(config.guildId).catch((error) => {
      console.error('[DiscordIntegration] Verwaiste Rollen konnten nicht geprüft werden:', error)
      return [] as DiscordGuildMember[]
    })

    for (const member of members) {
      const memberId = snowflake(member.user?.id)
      if (!memberId || activeAgentDiscordIds.has(memberId)) continue

      const rolesToRemove = (member.roles ?? []).filter((roleId) => managedRoleSet.has(roleId))
      for (const roleId of rolesToRemove) {
        try {
          await discordFetch<void>(`/guilds/${config.guildId}/members/${memberId}/roles/${roleId}`, { method: 'DELETE' })
        } catch (err) {
          if (isUnknownDiscordMember(err)) break
          if (isMissingDiscordPermissions(err)) {
            blockMemberPermissions(memberId)
            break
          }
          console.error('[DiscordIntegration] Verwaiste Rolle entfernen fehlgeschlagen:', err)
        }
      }
    }
  }

  await emitProgress('completed', undefined, 'Full-Sync abgeschlossen')

  return { synced, skipped, failed, total: agents.length }
}

function bracketedServiceNumber(badgeNumber: string, prefix: string) {
  const b = badgeNumber.trim()
  const p = prefix.trim()
  if (!p) return `[${b}]`
  if (b.startsWith(p)) return `[${b}]`
  const join = p.endsWith('-') ? `${p}${b}` : `${p}-${b}`
  return `[${join}]`
}

async function postChannelMessage(channelId: string, payload: Record<string, unknown>) {
  return discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

function cleanUpdateLines(lines: string[] | undefined) {
  return (lines ?? [])
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function updateAnnouncementBlock(name: string, lines: string[]): string | null {
  const cleaned = cleanUpdateLines(lines)
  if (cleaned.length === 0) return null
  const content = truncate(cleaned.map((line) => `- ${line}`).join('\n'), 3000)
  return `### ${name}\n${content}`
}

export async function sendDiscordUpdateAnnouncement(input: DiscordUpdateAnnouncementInput) {
  const config = await getDiscordConfig()
  const channelId = config.updateChannelId || config.announcementsChannelId
  if (!channelId) throw new Error('Update-Channel ist nicht konfiguriert')
  if (!botToken()) throw new Error('Discord Bot-Token fehlt')

  const title = input.title.trim()
  if (!title) throw new Error('Titel ist erforderlich')

  const blocks = [
    updateAnnouncementBlock('Neue Funktionen', input.added ?? []),
    updateAnnouncementBlock('Verbesserungen', input.changed ?? []),
    updateAnnouncementBlock('Nicht mehr enthalten', input.removed ?? []),
  ].filter((block): block is string => Boolean(block))

  if (blocks.length === 0) {
    throw new Error('Mindestens ein Changelog-Eintrag ist erforderlich')
  }

  const now = new Date()
  const version = input.version?.trim()
  const note = input.note?.trim()
  const actorLabel = input.actor ? discordUserLabel(input.actor) : 'System'

  return postChannelMessage(channelId, componentMessage(markdownTextDisplays([
    markdownHeader('📢', truncate(title, 240), version ? `v${version.replace(/^v/i, '')}` : null),
    'Hallo zusammen,\n\nhier sind die wichtigsten Änderungen:',
    note || null,
    ...blocks,
    `Mit freundlichen Grüßen\n${input.actor ? actorLabel : '**Systemadministration**'}`,
    markdownMeta([discordTimestamp(now, 'f')]),
  ])))
}

async function runAbsenceExpiryTick() {
  const now = new Date()
  const stale = await prisma.agent.count({
    where: {
      status: 'AWAY',
      absenceNotices: {
        none: { startsAt: { lte: now }, endsAt: { gte: now } },
      },
    },
  })
  const recentlyExpired = await prisma.absenceNotice.count({
    where: {
      endsAt: {
        lt: now,
        gte: new Date(now.getTime() - ABSENCE_EXPIRY_CHECK_INTERVAL_MS - 5_000),
      },
    },
  })
  if (stale === 0 && recentlyExpired === 0) return
  await syncDiscordAbsenceStatusMessage()
}

export function ensureAbsenceExpiryChecker() {
  if (absenceExpiryCheckerStarted || typeof setInterval !== 'function') return
  absenceExpiryCheckerStarted = true
  setInterval(() => {
    void runAbsenceExpiryTick().catch((error) => {
      console.error('[DiscordIntegration] Abmeldungs-Ablaufprüfung fehlgeschlagen:', error)
    })
  }, ABSENCE_EXPIRY_CHECK_INTERVAL_MS).unref?.()
}

export function ensureDiscordSyncScheduler() {
  ensureCodenameBoardScheduler()
  if (syncSchedulerStarted || typeof setInterval !== 'function') return
  const intervalMs = Number.parseInt(process.env.DISCORD_ROLE_SYNC_INTERVAL_MS || '0', 10)
  if (!Number.isFinite(intervalMs) || intervalMs < 300000) return

  syncSchedulerStarted = true
  setInterval(() => {
    void syncAllAgentDiscordRoles().catch((error) => {
      console.error('[DiscordIntegration] Vollständiger Rollensync fehlgeschlagen:', error)
    })
  }, intervalMs).unref?.()
}

function hrEventChannelId(config: DiscordConfig, type: keyof typeof EVENT_META) {
  if (type === 'sanction') return config.sanctionsChannelId || config.announcementsChannelId
  return config.announcementsChannelId
}

function trainingRoleValue(config: DiscordConfig, change: DiscordTrainingChange) {
  const roleId = snowflake(config.trainingRoleMap[change.trainingId])
  return roleId ? `<@&${roleId}>` : change.label
}

function trainingChangeLine(change: DiscordTrainingChange, config: DiscordConfig) {
  return `- ${trainingRoleValue(config, change)}: **${change.completed ? 'abgeschlossen' : 'nicht abgeschlossen'}**`
}

async function unitChangeBlock(change: DiscordUnitChange, config: DiscordConfig) {
  const keys = Array.from(new Set([...change.previous, ...change.current]))
  const previousSet = new Set(change.previous)
  const currentSet = new Set(change.current)
  const added = change.current.filter((key) => !previousSet.has(key))
  const removed = change.previous.filter((key) => !currentSet.has(key))
  const units = keys.length > 0
    ? await prisma.unit.findMany({
        where: { key: { in: keys } },
        select: { key: true, name: true },
      })
    : []
  const namesByKey = new Map(units.map((unit) => [unit.key, unit.name]))
  const unitLabel = (key: string) => {
    const roleId = snowflake(config.unitRoleMap[key])
    return roleId ? `<@&${roleId}>` : `**${namesByKey.get(key) ?? key}**`
  }
  const list = (unitKeys: string[]) => unitKeys.map(unitLabel).join(', ')
  const details = [
    added.length ? `- **Neu zugeordnet:** ${list(added)}` : null,
    removed.length ? `- **Nicht mehr zugeordnet:** ${list(removed)}` : null,
    `- **Aktuelle Zuordnung:** ${change.current.length ? list(change.current) : 'keine Unit'}`,
  ].filter((line): line is string => Boolean(line))

  return `### Organisatorische Zuordnung\n${details.join('\n')}`
}

function polishedEventDescription(value: string | undefined) {
  if (!value?.trim()) return ''
  return value
    .replace(/\bvia Discord-Command\b/gi, '')
    .replace(/\bvia Discord\b/gi, '')
    .replace(/\bvia Roster-Verschiebung\b/gi, 'im Rahmen der Dienstplanung')
    .replace(/\bvia Liste\b/gi, 'im Rahmen der Liste')
    .replace(/\büber das Dashboard\b/gi, '')
    .replace(/\büber Discord\b/gi, '')
    .replace(/\bim HR-Panel\b/gi, '')
    .replace(/Zugeordnete FIB-Rollen wurden entfernt\.?/gi, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

function officialEventIntroduction(type: keyof typeof EVENT_META, name: string) {
  const subject = name ? ` **${name}**` : ''
  switch (type) {
    case 'hire':
      return `${subject} ist dem FIB beigetreten. Willkommen im Team!`.trim()
    case 'promotion':
      return `Der Dienstgrad von${subject} wurde geändert.`
    case 'training':
      return `Der Ausbildungsstand von${subject} wurde aktualisiert.`
    case 'units':
      return `Die Unit-Zuordnung von${subject} wurde geändert.`
    case 'sanction':
      return `Für${subject} wurde eine Sanktion eingetragen.`
    case 'termination':
      return `Das Dienstverhältnis von${subject} wurde beendet.`
    case 'update':
      return subject ? `Es gibt eine neue Mitteilung zu${subject}.` : 'Es gibt eine neue Mitteilung.'
  }
}

async function buildDiscordHrEventPayload(event: DiscordHrEventInput, config: DiscordConfig) {
  const agent = event.agent
  const meta = EVENT_META[event.type]
  const now = new Date()
  const prefix = await getBadgePrefix()
  const actorLabel = event.actor ? discordUserLabel(event.actor) : 'System'
  const agentDisplayName = agent ? agentName(agent) : ''
  const customHeading = event.type === 'promotion' || event.type === 'update'
    ? event.title.trim().replace(/:\s*/, ' · ')
    : meta.label
  const headingSubject = agentDisplayName && !customHeading.toLocaleLowerCase('de-DE').includes(agentDisplayName.toLocaleLowerCase('de-DE'))
    ? agentDisplayName
    : null

  const rows: Array<{ label: string; value: string }> = []

  if (agent) {
    const dn = bracketedServiceNumber(agent.badgeNumber, prefix)
    const rankRoleSnow = snowflake(agent.rankId ? config.rankRoleMap[agent.rankId] : '')
    const rankValue = rankRoleSnow ? `<@&${rankRoleSnow}>` : agent.rank?.name ?? '—'
    rows.push({ label: 'Dienstnummer', value: `\`${dn}\`` })
    rows.push({ label: 'Rang', value: rankValue })
    if (event.type === 'hire') {
      rows.push({ label: 'Eintrittsdatum', value: discordTimestamp(agent.hireDate ?? now, 'D') })
    }
  }

  for (const field of event.fields ?? []) {
    rows.push({ label: field.name, value: field.value })
  }

  const trainingBlock = event.type === 'training' && event.trainingChanges?.length
    ? `### Ausbildung\n${event.trainingChanges.map((change) => trainingChangeLine(change, config)).join('\n')}`
    : null
  const unitsBlock = event.unitChange
    ? await unitChangeBlock(event.unitChange, config)
    : null

  const mentionIds = Array.from(
    new Set((event.mentionUserIds ?? []).map((id) => snowflake(id)).filter((id): id is string => Boolean(id))),
  )
  const pingLine = mentionIds.length ? mentionIds.map((id) => `<@${id}>`).join(' ') : null
  const allowedMentions = mentionIds.length ? { users: mentionIds } : undefined
  const salutation = event.type === 'sanction' && mentionIds.length === 1
    ? `Hallo <@${mentionIds[0]}>,`
    : 'Hallo zusammen,'
  const description = polishedEventDescription(event.description)
  const message = [officialEventIntroduction(event.type, agentDisplayName), description]
    .filter(Boolean)
    .join(' ')
  const letter = `${salutation}\n\n${message}`
  const closing = `Mit freundlichen Grüßen\n${event.actor ? actorLabel : '**Human Resources**'}`

  return componentMessage(
    markdownTextDisplays([
      markdownHeader(meta.icon, customHeading, headingSubject),
      event.type === 'sanction' ? null : pingLine,
      letter,
      rows.length ? `### Details\n${markdownRows(rows)}` : null,
      trainingBlock,
      unitsBlock,
      closing,
      markdownMeta([discordTimestamp(now, 'f')]),
    ]),
    allowedMentions ? { allowedMentions } : undefined,
  )
}

export async function sendDiscordHrEvent(event: DiscordHrEventInput): Promise<DiscordHrEventMessage | null> {
  const config = await getDiscordConfig()
  const channelId = hrEventChannelId(config, event.type)
  if (!channelId || !botToken()) return null

  const payload = await buildDiscordHrEventPayload(event, config)
  const message = await postChannelMessage(channelId, payload)
  return { channelId, messageId: message.id }
}

/* ── Vertragsnachrichten (DM mit Channel-Fallback) ───────────────── */

export type DiscordContractMessageInput = {
  discordId: string | null | undefined
  agentName: string
  badgeNumber?: string | null
  rankName?: string | null
  contractTitle: string
  contractUrl: string
  /** true = Erinnerung an einen bereits versendeten Vertrag. */
  reminder?: boolean
  /** Zusätzlicher Hinweistext der HR-Abteilung. */
  note?: string | null
}

export type DiscordContractMessageResult = {
  delivered: boolean
  /** 'dm' = private Nachricht, 'channel' = öffentlicher Fallback-Channel. */
  via: 'dm' | 'channel' | null
  channelId: string | null
  messageId: string | null
  error: string | null
}

/**
 * Discord erlaubt keinen direkten POST an einen User — man muss erst einen
 * DM-Channel öffnen. Der Aufruf schlägt fehl, wenn der Bot mit dem User keinen
 * gemeinsamen Server hat.
 */
async function openDirectMessageChannel(discordId: string) {
  const channel = await discordFetch<{ id: string }>('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: discordId }),
  })
  return channel.id
}

/** Discord-Fehlercode 50007: „Cannot send messages to this user“ (DMs zu). */
function isClosedDirectMessage(error: unknown) {
  return error instanceof DiscordApiError && (error.code === 50007 || error.status === 403)
}

function buildContractMessagePayload(input: DiscordContractMessageInput, options: { mentionUser: boolean }) {
  const heading = input.reminder ? 'Erinnerung zu Ihrem Arbeitsvertrag' : 'Ihr Arbeitsvertrag'
  const rows: Array<{ label: string; value: string }> = []
  if (input.badgeNumber) rows.push({ label: 'Dienstnummer', value: `\`${input.badgeNumber}\`` })
  if (input.rankName) rows.push({ label: 'Vorgesehener Rang', value: input.rankName })
  rows.push({ label: 'Vertrag', value: input.contractTitle })

  const mentionId = options.mentionUser ? snowflake(input.discordId) : ''
  const recipient = mentionId ? `<@${mentionId}>` : `**${input.agentName}**`
  const introduction = input.reminder
    ? 'bitte prüfen und unterschreiben Sie noch Ihren Arbeitsvertrag.'
    : 'Ihr Arbeitsvertrag ist bereit. Bitte prüfen, ausfüllen und unterschreiben Sie ihn.'

  return componentMessage(
    [
      ...markdownTextDisplays([
        markdownHeader('📝', heading),
        `Guten Tag ${recipient},\n\n${introduction}`,
        input.note ? `**Hinweis:** ${input.note}` : null,
        markdownRows(rows),
        'Mit freundlichen Grüßen\n**Human Resources**',
        markdownMeta(['Persönlicher Link · nicht weitergeben']),
      ]),
      actionRow([linkButton('Vertrag öffnen & unterschreiben', input.contractUrl)]),
    ],
    mentionId ? { allowedMentions: { users: [mentionId] } } : undefined,
  )
}

/**
 * Schickt die Vertragsnachricht per DM. Ist keine DM möglich (DMs geschlossen,
 * kein gemeinsamer Server, keine Discord-ID), wird stattdessen im konfigurierten
 * Vertrags-Channel gepostet und der Agent dort erwähnt — die Aufforderung geht
 * also nie verloren.
 */
export async function sendDiscordContractMessage(
  input: DiscordContractMessageInput,
): Promise<DiscordContractMessageResult> {
  const empty: DiscordContractMessageResult = {
    delivered: false,
    via: null,
    channelId: null,
    messageId: null,
    error: null,
  }

  if (!botToken()) {
    return { ...empty, error: 'Discord Bot-Token fehlt' }
  }

  const config = await getDiscordConfig()
  const discordId = snowflake(input.discordId)
  let dmError: string | null = null

  if (discordId) {
    try {
      const channelId = await openDirectMessageChannel(discordId)
      const message = await postChannelMessage(channelId, buildContractMessagePayload(input, { mentionUser: false }))
      return { delivered: true, via: 'dm', channelId, messageId: message.id, error: null }
    } catch (error) {
      dmError = error instanceof Error ? error.message : 'DM fehlgeschlagen'
      if (!isClosedDirectMessage(error) && !isUnknownDiscordMember(error)) {
        console.warn('[DiscordIntegration] Vertrags-DM fehlgeschlagen, versuche Channel-Fallback:', dmError)
      }
    }
  } else {
    dmError = 'Agent hat keine hinterlegte Discord-ID'
  }

  const fallbackChannelId = config.contractsChannelId || config.announcementsChannelId
  if (!fallbackChannelId) {
    return {
      ...empty,
      error: `${dmError ?? 'DM nicht möglich'} — und es ist kein Vertrags-/Ankündigungs-Channel als Fallback konfiguriert`,
    }
  }

  try {
    const message = await postChannelMessage(
      fallbackChannelId,
      buildContractMessagePayload(input, { mentionUser: Boolean(discordId) }),
    )
    return {
      delivered: true,
      via: 'channel',
      channelId: fallbackChannelId,
      messageId: message.id,
      error: dmError,
    }
  } catch (error) {
    const channelError = error instanceof Error ? error.message : 'Channel-Nachricht fehlgeschlagen'
    return { ...empty, error: `${dmError ?? 'DM nicht möglich'} / ${channelError}` }
  }
}

export async function editDiscordHrEventMessage(
  channelId: string | null | undefined,
  messageId: string | null | undefined,
  event: DiscordHrEventInput,
) {
  if (!channelId || !messageId || !botToken()) return
  const config = await getDiscordConfig()
  const payload = await buildDiscordHrEventPayload(event, config)
  await discordFetch<void>(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...payload, content: null, embeds: [] }),
  })
}

export async function postHireRolePing(channelId: string, roleId: string, nonce: string) {
  return discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId], users: [] }, nonce, enforce_nonce: true }),
  })
}

export async function deleteDiscordHrEventMessage(
  channelId: string | null | undefined,
  messageId: string | null | undefined,
) {
  if (!channelId || !messageId || !botToken()) return
  try {
    await discordFetch<void>(`/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
    })
  } catch (error) {
    // 404 (Unknown Message/Channel) bedeutet, die Nachricht ist bereits weg – das ist in Ordnung.
    if (error instanceof DiscordApiError && error.status === 404) return
    throw error
  }
}

function chunkLines(lines: string[], maxChars = 1024) {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    const candidate = current ? `${current}\n\n${line}` : line
    if (candidate.length > maxChars && current) {
      chunks.push(current)
      current = line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line
    } else {
      current = candidate.length > maxChars ? `${candidate.slice(0, maxChars - 1)}…` : candidate
    }
  }
  if (current) chunks.push(current)
  return chunks
}

const DUTY_LIST_LIMIT = 25

async function dutyStatusPayload() {
  const [snapshot, prefix] = await Promise.all([
    getDutyTimesSnapshot(),
    getBadgePrefix(),
  ])

  const visible = snapshot.activeRows.slice(0, DUTY_LIST_LIMIT)
  const overflow = Math.max(0, snapshot.activeRows.length - visible.length)

  const summary = markdownRows([
    { label: 'Im Dienst', value: `\`${snapshot.activeCount}\`` },
    { label: 'Dienstzeit dieser Woche', value: `\`${formatDuration(snapshot.totalWeekDurationMs)}\`` },
  ])
  const listParts: string[] = []

  if (visible.length === 0) {
    listParts.push('> Derzeit ist niemand im Dienst.')
  } else {
    const lines = visible.map((row, index) => {
      const num = String(index + 1).padStart(2, '0')
      const active = row.activePlaySession
      const since = active?.startedAt ? discordTimestamp(active.startedAt, 'R') : '—'
      const current = formatDuration(active?.currentDurationMs ?? 0)
      const dn = bracketedServiceNumber(agentBadge(row), prefix)
      return [
        `\`${num}\`  **${agentName(row)}**  ·  ${row.rank.name}  ·  **${current}**`,
        `> \`${dn}\`  ·  ${mention(row.discordId)}  ·  seit ${since}`,
      ].join('\n')
    })
    listParts.push(...chunkLines(lines, 3000))
    if (overflow > 0) listParts.push(`-# … und ${overflow} weitere`)
  }

  return componentMessage(markdownTextDisplays([
    markdownHeader('🚓', 'Dienststatus'),
    summary,
    '### Aktuell im Dienst',
    ...listParts,
    markdownMeta([`Stand ${discordTimestamp(new Date(), 'f')}`]),
  ]))
}

async function saveDutyStatusMessageId(messageId: string) {
  await prisma.systemSetting.upsert({
    where: { key: DISCORD_SETTING_KEYS.dutyStatusMessageId },
    update: { value: messageId },
    create: { key: DISCORD_SETTING_KEYS.dutyStatusMessageId, value: messageId },
  })
}

export async function syncDiscordDutyStatusMessage(options?: { forceCreate?: boolean }) {
  const config = await getDiscordConfig()
  const channelId = config.dutyStatusChannelId || config.announcementsChannelId
  if (!channelId || !botToken()) return

  const payload = await dutyStatusPayload()
  if (config.dutyStatusMessageId && !options?.forceCreate) {
    await discordFetch<void>(`/channels/${channelId}/messages/${config.dutyStatusMessageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, content: null, embeds: [] }),
    }).catch(async () => {
      const message = await postChannelMessage(channelId, payload)
      await saveDutyStatusMessageId(message.id)
    })
    return
  }

  const message = await postChannelMessage(channelId, payload)
  await saveDutyStatusMessageId(message.id)
}

const ABSENCE_LIST_LIMIT = 25

async function absenceStatusPayload() {
  await runAgentStatusAutomation({ force: true })
  const [absences, prefix] = await Promise.all([
    getActiveAbsenceNotices(),
    getBadgePrefix(),
  ])
  const visible = absences.slice(0, ABSENCE_LIST_LIMIT)
  const overflow = Math.max(0, absences.length - visible.length)

  const listParts: string[] = []

  if (visible.length === 0) {
    listParts.push('> Aktuell ist niemand abgemeldet.')
  } else {
    const lines = visible.map((notice, index) => {
      const num = String(index + 1).padStart(2, '0')
      const agent = notice.agent
      const reason = truncate(notice.reason.replace(/\s+/g, ' '), 180)
      const dn = bracketedServiceNumber(agentBadge(agent), prefix)
      return [
        `\`${num}\`  **${agentName(agent)}**  ·  ${agent.rank.name}`,
        `> \`${dn}\`  ·  ${mention(agent.discordId)}  ·  bis ${discordTimestamp(notice.endsAt, 'R')}`,
        `> *${reason}*`,
      ].join('\n')
    })
    listParts.push(...chunkLines(lines, 3000))
    if (overflow > 0) listParts.push(`-# … und ${overflow} weitere`)
  }

  return componentMessage([
    ...markdownTextDisplays([
      markdownHeader('🌴', 'Abmeldungen'),
      markdownRows([{ label: 'Aktiv', value: `\`${absences.length}\`` }]),
      '### Aktuelle Abmeldungen',
      ...listParts,
      markdownMeta([`Stand ${discordTimestamp(new Date(), 'f')}`]),
    ]),
    actionRow([
          { type: 2, style: 1, custom_id: 'fib_absence_create', label: 'Abmelden' },
          { type: 2, style: 4, custom_id: 'fib_absence_cancel', label: 'Abmeldung beenden' },
          { type: 2, style: 2, custom_id: 'fib_absence_refresh', label: 'Aktualisieren' },
    ]),
  ])
}

async function saveAbsenceStatusMessageId(messageId: string) {
  await prisma.systemSetting.upsert({
    where: { key: DISCORD_SETTING_KEYS.absenceStatusMessageId },
    update: { value: messageId },
    create: { key: DISCORD_SETTING_KEYS.absenceStatusMessageId, value: messageId },
  })
}

export async function syncDiscordAbsenceStatusMessage(options?: { forceCreate?: boolean }) {
  const config = await getDiscordConfig()
  const channelId = config.absenceStatusChannelId || config.dutyStatusChannelId || config.announcementsChannelId
  if (!channelId || !botToken()) return

  const payload = await absenceStatusPayload()
  if (config.absenceStatusMessageId && !options?.forceCreate) {
    await discordFetch<void>(`/channels/${channelId}/messages/${config.absenceStatusMessageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, content: null, embeds: [] }),
    }).catch(async () => {
      const message = await postChannelMessage(channelId, payload)
      await saveAbsenceStatusMessageId(message.id)
    })
    return
  }

  const message = await postChannelMessage(channelId, payload)
  await saveAbsenceStatusMessageId(message.id)
}

export function queueAgentRoleSync(agentId: string, mode: 'sync' | 'remove-all' = 'sync') {
  ensureDiscordSyncScheduler()
  pendingAgentRoleSyncModes.set(agentId, mode)
  if (runningAgentRoleSyncs.has(agentId)) return

  runningAgentRoleSyncs.add(agentId)
  void (async () => {
    try {
      while (pendingAgentRoleSyncModes.has(agentId)) {
        const nextMode = pendingAgentRoleSyncModes.get(agentId) ?? 'sync'
        pendingAgentRoleSyncModes.delete(agentId)
        await syncAgentDiscordRoles(agentId, nextMode)
      }
    } catch (error) {
      console.error('[DiscordIntegration] Rollensync fehlgeschlagen:', error)
      queueDiscordWebhookEvent({
        title: 'Discord-Rollensync fehlgeschlagen',
        severity: 'error',
        source: 'discord-integration',
        fields: [{ name: 'Agent-ID', value: agentId, inline: true }],
        error,
      })
    } finally {
      runningAgentRoleSyncs.delete(agentId)
      if (pendingAgentRoleSyncModes.has(agentId)) {
        queueAgentRoleSync(agentId, pendingAgentRoleSyncModes.get(agentId))
      }
    }
  })()
}

export function queueAllAgentRoleSync(options?: { extraManagedRoleIds?: string[] }) {
  ensureDiscordSyncScheduler()
  void syncAllAgentDiscordRoles(options).catch((error) => {
    console.error('[DiscordIntegration] Vollständiger Rollensync fehlgeschlagen:', error)
    queueDiscordWebhookEvent({
      title: 'Discord-Rollensync fehlgeschlagen',
      description: 'Vollständiger Rollensync konnte nicht abgeschlossen werden.',
      severity: 'error',
      source: 'discord-integration',
      error,
    })
  })
}

export function queueDiscordHrEvent(event: Parameters<typeof sendDiscordHrEvent>[0]) {
  if (event.type === 'hire' && event.agent?.id) {
    const agentId = event.agent.id
    void import('./hire-ping').then(({ queueHirePing }) => queueHirePing(agentId)).catch(error => console.error('[HirePing]', error))
  }
  void sendDiscordHrEvent(event).catch((error) => {
    console.error('[DiscordIntegration] Event-Versand fehlgeschlagen:', error)
    queueDiscordWebhookEvent({
      title: 'Discord-HR-Meldung fehlgeschlagen',
      severity: 'error',
      source: 'discord-integration',
      fields: [{ name: 'Event', value: event.title, inline: true }],
      error,
    })
  })
}

/* ── Ermittlungssystem ────────────────────────────────────────────── */

export type DiscordInvestigationEventInput = {
  type: 'created' | 'status' | 'clip' | 'closed'
  caseNumber: string
  title: string
  /// Verschlusssachen werden nie gepostet – der Aufrufer muss das Flag setzen.
  classified: boolean
  leadAgentName?: string | null
  actorName?: string | null
  rows?: Array<{ label: string; value: string | null | undefined }>
  note?: string | null
}

const INVESTIGATION_EVENT_META = {
  created: { icon: '🗂️', label: 'Neue Ermittlungsakte' },
  status: { icon: '🔄', label: 'Aktenstatus geändert' },
  clip: { icon: '🎥', label: 'Neuer Bodycam-Clip' },
  closed: { icon: '📕', label: 'Ermittlung abgeschlossen' },
} as const

export async function sendDiscordInvestigationEvent(event: DiscordInvestigationEventInput) {
  // Vertrauliche Akten verlassen das Dashboard grundsätzlich nicht.
  if (event.classified) return null

  const config = await getDiscordConfig()
  const channelId = config.investigationsChannelId
  if (!channelId || !botToken()) return null

  const meta = INVESTIGATION_EVENT_META[event.type]
  const rows = [
    { label: 'Aktenzeichen', value: event.caseNumber },
    { label: 'Fallführung', value: event.leadAgentName || null },
    ...(event.rows ?? []),
    { label: 'Erfasst von', value: event.actorName || null },
  ].filter((row) => Boolean(row.value))

  const payload = componentMessage(
    markdownTextDisplays([
      markdownHeader(meta.icon, meta.label, event.title),
      event.note ? markdownQuote(event.note) : null,
      rows.length ? `### Details\n${markdownRows(rows)}` : null,
      markdownMeta([discordTimestamp(new Date(), 'f')]),
    ]),
  )

  const message = await postChannelMessage(channelId, payload)
  return { channelId, messageId: message.id }
}

export function queueDiscordInvestigationEvent(event: DiscordInvestigationEventInput) {
  void sendDiscordInvestigationEvent(event).catch((error) => {
    console.error('[DiscordIntegration] Ermittlungs-Meldung fehlgeschlagen:', error)
    queueDiscordWebhookEvent({
      title: 'Discord-Ermittlungsmeldung fehlgeschlagen',
      severity: 'error',
      source: 'discord-integration',
      fields: [{ name: 'Akte', value: event.caseNumber, inline: true }],
      error,
    })
  })
}

export function queueDiscordDutyStatusUpdate() {
  ensureAbsenceExpiryChecker()
  void syncDiscordDutyStatusMessage().catch((error) => {
    console.error('[DiscordIntegration] Dienststatus-Nachricht fehlgeschlagen:', error)
    queueDiscordWebhookEvent({
      title: 'Discord-Dienstzeiten-Panel fehlgeschlagen',
      severity: 'error',
      source: 'discord-integration',
      error,
    })
  })
}

export function queueDiscordAbsenceStatusUpdate() {
  ensureAbsenceExpiryChecker()
  void syncDiscordAbsenceStatusMessage().catch((error) => {
    console.error('[DiscordIntegration] Abmeldungsnachricht fehlgeschlagen:', error)
    queueDiscordWebhookEvent({
      title: 'Discord-Abmeldungs-Panel fehlgeschlagen',
      severity: 'error',
      source: 'discord-integration',
      error,
    })
  })
}

// A single queue serializes automatic and manual runs. Each queued run reads a
// fresh roster, so a change arriving during a PATCH is not lost.
let codenameBoardTail: Promise<unknown> = Promise.resolve()
let codenameBoardSchedulerStarted = false

function ensureCodenameBoardScheduler() {
  if (codenameBoardSchedulerStarted) return
  codenameBoardSchedulerStarted = true
  setInterval(queueCodenameBoardUpdate, 300_000).unref?.()
}

export function syncDiscordCodenameBoard() {
  const next = codenameBoardTail.then(runCodenameBoardSync)
  codenameBoardTail = next.catch(() => undefined)
  return next
}

export function queueCodenameBoardUpdate() {
  ensureCodenameBoardScheduler()
  void syncDiscordCodenameBoard().catch(cause => {
    console.error('[DiscordIntegration] Decknamen-Board fehlgeschlagen:', cause)
  })
}

async function runCodenameBoardSync() {
  const config = await getDiscordConfig()
  if (!botToken()) return { skipped: true, messageIds: [] as string[] }
  const channelId = config.codenameBoardChannelId
  const channelKey = 'discord.codenameBoardStoredChannelId'
  const previousChannel = await prisma.systemSetting.findUnique({ where: { key: channelKey } })
  let ids = [...config.codenameBoardMessageIds]
  const saveIds = async () => {
    const value = JSON.stringify(ids)
    await prisma.systemSetting.upsert({ where: { key: DISCORD_SETTING_KEYS.codenameBoardMessageIds }, create: { key: DISCORD_SETTING_KEYS.codenameBoardMessageIds, value }, update: { value } })
  }
  const remove = async (channel: string, id: string) => {
    try { await discordFetch(`/channels/${channel}/messages/${id}`, { method: 'DELETE' }) }
    catch (cause) { if (!(cause instanceof DiscordApiError && cause.status === 404 && cause.code === 10008)) throw cause }
  }
  if (previousChannel?.value && previousChannel.value !== channelId) {
    while (ids.length) {
      await remove(previousChannel.value, ids[ids.length - 1])
      ids.pop()
      await saveIds()
    }
  }
  if (!channelId) return { skipped: true, messageIds: ids }
  await prisma.systemSetting.upsert({ where: { key: channelKey }, create: { key: channelKey, value: channelId }, update: { value: channelId } })
  const { codenameBoardPages, reconcileCodenameMessages } = await import('./codename-board')
  const { formatCodename, codenameAgentSelect } = await import('./codenames')
  const [rows, prefix] = await Promise.all([
    prisma.codename.findMany({ where: { currentAgentId: { not: null } }, include: { currentAgent: { select: codenameAgentSelect } }, orderBy: { name: 'asc' } }),
    formatCodename(''),
  ])
  const pages = codenameBoardPages(rows, prefix)
  const payloads = pages.map((page, index) => componentMessage(markdownTextDisplays([
      markdownHeader('🎭', 'Decknamen — aktuelle Belegung', `${index + 1}/${pages.length}`),
      page,
      markdownMeta([`${rows.length} vergeben`, `zuletzt aktualisiert ${discordTimestamp(new Date(), 'f')}`]),
    ])))
  ids = await reconcileCodenameMessages({
    ids, pages: payloads,
    patch: async (id, payload) => { await discordFetch(`/channels/${channelId}/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ ...payload, content: null, embeds: [] }) }) },
    post: async payload => (await postChannelMessage(channelId, payload)).id,
    remove: id => remove(channelId, id),
    save: async nextIds => { ids = nextIds; await saveIds() },
    isMissing: cause => cause instanceof DiscordApiError && cause.status === 404 && cause.code === 10008,
  })
  return { skipped: false, messageIds: ids }
}

export type DiscordPhotoMessage = {
  id: string
  content?: string
  attachments?: { id: string; filename: string; url: string; content_type?: string; size?: number }[]
}

export async function getDiscordPhotoMessages(channelId: string, before?: string) {
  if (!/^\d{17,22}$/.test(channelId) || (before && !/^\d{17,22}$/.test(before))) throw new Error('Ungültige Discord-Channel-ID')
  return discordFetch<DiscordPhotoMessage[]>(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`)
}
