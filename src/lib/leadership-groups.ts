import { z } from 'zod'
import { hasPermission } from './permissions'
import { componentMessage, markdownHeader, markdownMeta, markdownQuote, markdownTextDisplays } from './discord-components'

export function canManageLeadershipGroups(user: { permissions?: string[] | null } | null) {
  return hasPermission(user, 'leadership-groups:manage')
}

export function leadershipGroupVisibility(user: { id: string; permissions?: string[] | null }) {
  return canManageLeadershipGroups(user) ? {} : { members: { some: { userId: user.id } } }
}

const discordId = z.string().regex(/^\d{17,22}$/, 'Bitte eine gültige Discord-Kanal-ID (17–22 Ziffern) eingeben.')

export const leadershipGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // Ein leerer Wert bedeutet: eigenen privaten Kanal anlegen bzw. behalten.
  channelId: z.union([discordId, z.literal('')]).optional(),
  memberIds: z.array(z.string().min(1).max(191)).min(1).max(90),
  families: z.array(z.object({
    name: z.string().trim().min(1, 'Bitte einen Familiennamen eingeben.').max(100),
    leadIds: z.array(z.string().min(1).max(191)).min(1).max(2),
  })).max(100),
  version: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (new Set(data.memberIds).size !== data.memberIds.length)
    ctx.addIssue({ code: 'custom', message: 'Mitglieder dürfen nicht doppelt vorkommen.' })
  const names = data.families.map(f => f.name.trim().toLowerCase())
  if (new Set(names).size !== names.length)
    ctx.addIssue({ code: 'custom', message: 'Jede Familie darf nur einmal zugeordnet sein.' })
  for (const family of data.families) {
    if (new Set(family.leadIds).size !== family.leadIds.length || family.leadIds.some(id => !data.memberIds.includes(id)))
      ctx.addIssue({ code: 'custom', message: 'Pro Familie sind ein bis zwei unterschiedliche Gruppenmitglieder als Leitung erforderlich.' })
  }
})

export type LeadershipGroupInput = z.infer<typeof leadershipGroupSchema>
export type LeadershipGroupFamily = LeadershipGroupInput['families'][number]

const SNOWFLAKE = /^\d{17,22}$/

type GroupAccount = { id: string; displayName: string; discordId: string | null; agentProfile?: { discordId: string | null } | null }

/** Das Konto hat Vorrang; fehlt dort die Verknüpfung, gilt die Discord-ID aus der Personalakte. */
export function memberDiscordId(user: Pick<GroupAccount, 'discordId' | 'agentProfile'>) {
  return [user.discordId, user.agentProfile?.discordId].find(id => !!id && SNOWFLAKE.test(id)) ?? null
}

/** `hint` markiert Agents, die sichtbar, aber (noch) nicht auswählbar sind. */
export type GroupCandidate = { id: string; displayName: string; hint?: string }

export function groupCandidates(
  accounts: GroupAccount[],
  unlinkedAgents: { id: string; firstName: string; lastName: string; discordId: string | null }[],
  blockedUserIds: string[],
): GroupCandidate[] {
  const blocked = new Set(blockedUserIds)
  const accountDiscordIds = new Set(accounts.flatMap(account => account.discordId ? [account.discordId] : []))
  const candidates: GroupCandidate[] = accounts.flatMap(account => {
    if (blocked.has(account.id)) return []
    if (memberDiscordId(account)) return [{ id: account.id, displayName: account.displayName }]
    return account.agentProfile ? [{ id: account.id, displayName: account.displayName, hint: 'Keine Discord-Verknüpfung' }] : []
  })
  // Agents ohne Dashboard-Konto bleiben sichtbar, damit klar ist, warum sie fehlen.
  for (const agent of unlinkedAgents) {
    if (agent.discordId && accountDiscordIds.has(agent.discordId)) continue
    candidates.push({ id: `agent:${agent.id}`, displayName: `${agent.firstName} ${agent.lastName}`.trim(), hint: 'Kein Dashboard-Konto' })
  }
  return candidates.sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
}

export function privateChannelOverwrites(guildId: string, botId: string, memberIds: string[]) {
  return [
    { id: guildId, type: 0, allow: '0', deny: '1024' },
    { id: botId, type: 1, allow: '68624', deny: '0' },
    ...[...new Set(memberIds)].filter(id => id !== botId).map(id => ({
      id, type: 1, allow: '68608', deny: '0',
    })),
  ]
}

export const EVENT_KINDS = {
  created: { icon: '🗂️', title: 'Ermittlungsgruppe erstellt' },
  renamed: { icon: '✏️', title: 'Gruppe umbenannt' },
  added: { icon: '➕', title: 'Mitglied hinzugefügt' },
  removed: { icon: '➖', title: 'Mitglied entfernt' },
  families: { icon: '👪', title: 'Familien & Leitungen aktualisiert' },
  deleted: { icon: '🗑️', title: 'Gruppe aufgelöst' },
  info: { icon: 'ℹ️', title: 'Ermittlungsgruppe' },
} as const

export type LeadershipEventKind = keyof typeof EVENT_KINDS

/** Discord-Zeitstempel wie im übrigen Dashboard-Design (`<t:…:f>`). */
function discordTimestamp(date: Date, style: 'f' | 'R' = 'f') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`
}

function mention(discordId: string | null | undefined) {
  return discordId && /^\d{17,22}$/.test(discordId) ? `<@${discordId}>` : null
}

export function groupEventMessage(event: { kind: string; text: string; createdAt: Date }, groupName: string) {
  const kind = EVENT_KINDS[event.kind as LeadershipEventKind] ?? EVENT_KINDS.info
  return componentMessage(markdownTextDisplays([
    markdownHeader(kind.icon, kind.title, groupName),
    markdownQuote(event.text),
    markdownMeta([discordTimestamp(event.createdAt)]),
  ]))
}

export type LeadershipOverviewMember = { id: string; displayName: string; discordId?: string | null }

/** Angepinnte Übersicht: Familien mit Leitung und der aktuelle Mitgliederstand. */
export function groupOverviewMessage(group: { name: string; families: LeadershipGroupFamily[]; members: LeadershipOverviewMember[] }) {
  const label = (id: string) => {
    const member = group.members.find(m => m.id === id)
    return member ? mention(member.discordId) ?? member.displayName : 'Nicht mehr in der Gruppe'
  }
  const families = group.families.length
    ? group.families.map(family => `- **${family.name}** — ${family.leadIds.map(label).join(' & ') || 'Keine Leitung'}`).join('\n')
    : '-# Noch keine Familien zugewiesen.'
  const members = group.members.length
    ? group.members.map(member => `- ${mention(member.discordId) ?? member.displayName}`).join('\n')
    : '-# Noch keine Mitglieder.'
  return componentMessage(markdownTextDisplays([
    markdownHeader('🗂️', 'Ermittlungsgruppe', group.name),
    '### Familien & Leitungen',
    families,
    '### Mitglieder',
    members,
    markdownMeta([
      `${group.families.length} Familien`,
      `${group.members.length} Mitglieder`,
      `Stand ${discordTimestamp(new Date())}`,
    ]),
  ]))
}
