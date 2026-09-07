import { requireAuth } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { applyChangeHistory, ChangeHistoryConflictError } from '@/lib/change-history'

export async function POST() {
  try {
    const user = await requireAuth()
    const result = await applyChangeHistory(user.id, 'undo')
    await queueAffectedSyncs(result.affectedModels).catch((syncError) => {
      console.error('[change-history] Resync nach Undo fehlgeschlagen:', syncError)
    })
    return success(result.action)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Serverfehler'
    if (message === 'Unauthorized') return unauthorized()
    if (e instanceof ChangeHistoryConflictError) return error(message, 409)
    return error(message, 500)
  }
}

async function queueAffectedSyncs(models: string[]) {
  const set = new Set(models)
  const discord = await import('@/lib/discord-integration')
  if ([
    'Agent', 'AgentTraining', 'Rank', 'Training', 'Tier', 'TierRank', 'Unit',
    'UserUnitAssignment', 'SystemSetting', 'RankChangeListEntry', 'PromotionLog', 'Termination',
  ].some((model) => set.has(model))) {
    discord.queueAllAgentRoleSync()
  }
  if (set.has('AbsenceNotice')) discord.queueDiscordAbsenceStatusUpdate()
  if (set.has('DutyTimeSession')) discord.queueDiscordDutyStatusUpdate()
}
