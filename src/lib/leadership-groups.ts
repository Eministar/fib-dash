import { z } from 'zod'
import { hasPermission } from './permissions'
import { displayBadgeNumber } from './badge-number'
import { componentMessage, markdownHeader, markdownMeta, markdownQuote, markdownTextDisplays } from './discord-components'

export function canManageLeadershipGroups(user: { permissions?: string[] | null } | null) {
  return hasPermission(user, 'leadership-groups:manage')
}

/** `agentIds`: die Personalakten des angemeldeten Nutzers. */
export function leadershipGroupVisibility(user: { permissions?: string[] | null }, agentIds: string[]) {
  return canManageLeadershipGroups(user) ? {} : { agents: { some: { agentId: { in: agentIds } } } }
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

export type GroupAgent = { id: string; firstName: string; lastName: string; badgeNumber: string; discordId: string | null }

/** Mitglieder sind Personalakten; Discord-Zugriff kommt ausschließlich aus der Akte. */
export function agentDiscordId(agent: Pick<GroupAgent, 'discordId'>) {
  return agent.discordId && SNOWFLAKE.test(agent.discordId) ? agent.discordId : null
}

export function agentDisplayName(agent: GroupAgent) {
  return `${agent.firstName} ${agent.lastName} (${displayBadgeNumber(agent.badgeNumber)})`.trim()
}

/** `hint` markiert Agents, die sichtbar, aber (noch) nicht auswählbar sind. */
export type GroupCandidate = { id: string; displayName: string; hint?: string }

export function groupCandidates(agents: GroupAgent[]): GroupCandidate[] {
  return agents
    .map(agent => ({ id: agent.id, displayName: agentDisplayName(agent), ...(agentDiscordId(agent) ? {} : { hint: 'Keine Discord-ID in der Personalakte' }) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
}

/** Tauscht Leitungs-IDs aus; nicht zuordenbare Leitungen entfallen und müssen neu besetzt werden. */
export function remapFamilyLeads(value: unknown, map: (id: string) => string | null): LeadershipGroupFamily[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.name !== 'string') return []
    const leadIds = Array.isArray(entry.leadIds) ? entry.leadIds.flatMap((id: unknown) => {
      const next = typeof id === 'string' ? map(id) : null
      return next ? [next] : []
    }) : []
    return [{ name: entry.name, leadIds: [...new Set<string>(leadIds)] }]
  })
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
