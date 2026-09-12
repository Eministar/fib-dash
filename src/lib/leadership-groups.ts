import { z } from 'zod'
import { hasPermission } from './permissions'

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
  created: { title: 'Gruppe erstellt', color: 0x3ba55d },
  renamed: { title: 'Gruppe umbenannt', color: 0x5865f2 },
  added: { title: 'Mitglied hinzugefügt', color: 0x3ba55d },
  removed: { title: 'Mitglied entfernt', color: 0xed4245 },
  families: { title: 'Familien & Leitungen aktualisiert', color: 0x5865f2 },
  deleted: { title: 'Gruppe aufgelöst', color: 0xed4245 },
  info: { title: 'Ermittlungsgruppe', color: 0x5865f2 },
} as const

export type LeadershipEventKind = keyof typeof EVENT_KINDS

export function groupEventEmbed(event: { kind: string; text: string; createdAt: Date }, groupName: string) {
  const kind = EVENT_KINDS[event.kind as LeadershipEventKind] ?? EVENT_KINDS.info
  return {
    title: kind.title,
    description: event.text.slice(0, 4000),
    color: kind.color,
    timestamp: event.createdAt.toISOString(),
    footer: { text: `Ermittlungsgruppe ${groupName}`.slice(0, 2048) },
  }
}
