import { z } from 'zod'
import { hasPermission } from './permissions'

export function canManageLeadershipGroups(user: { permissions?: string[] | null } | null) {
  return hasPermission(user, 'leadership-groups:manage')
}

export function leadershipGroupVisibility(user: { id: string; permissions?: string[] | null }) {
  return canManageLeadershipGroups(user) ? {} : { members: { some: { userId: user.id } } }
}

export const leadershipGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  memberIds: z.array(z.string().min(1).max(191)).min(1).max(90),
  families: z.array(z.object({
    dossierId: z.string().min(1).max(191),
    leadIds: z.array(z.string().min(1).max(191)).min(1).max(2),
  })).max(100),
  version: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (new Set(data.memberIds).size !== data.memberIds.length)
    ctx.addIssue({ code: 'custom', message: 'Mitglieder dürfen nicht doppelt vorkommen.' })
  if (new Set(data.families.map(f => f.dossierId)).size !== data.families.length)
    ctx.addIssue({ code: 'custom', message: 'Jede Familie darf nur einmal zugeordnet sein.' })
  for (const family of data.families) {
    if (new Set(family.leadIds).size !== family.leadIds.length || family.leadIds.some(id => !data.memberIds.includes(id)))
      ctx.addIssue({ code: 'custom', message: 'Pro Familie sind ein bis zwei unterschiedliche Gruppenmitglieder als Leitung erforderlich.' })
  }
})

export type LeadershipGroupInput = z.infer<typeof leadershipGroupSchema>

export function privateChannelOverwrites(guildId: string, botId: string, memberIds: string[]) {
  return [
    { id: guildId, type: 0, allow: '0', deny: '1024' },
    { id: botId, type: 1, allow: '68624', deny: '0' },
    ...[...new Set(memberIds)].filter(id => id !== botId).map(id => ({
      id, type: 1, allow: '68608', deny: '0',
    })),
  ]
}
