import { z } from 'zod'
import { readSavedViews, sameFilters, savedViewsSchema, type SavedView } from '@/lib/saved-views'

export const agentViewFiltersSchema = z.object({
  search: z.string().max(200),
  status: z.enum(['', 'ACTIVE', 'AWAY', 'ON_LEAVE', 'INACTIVE']),
  rank: z.string().max(191),
  unit: z.string().max(191),
  flag: z.enum(['', '__any__', 'RED', 'ORANGE', 'YELLOW', 'BLUE', 'PURPLE']),
})
export const agentSavedViewsSchema = savedViewsSchema(agentViewFiltersSchema)
export type AgentViewFilters = z.infer<typeof agentViewFiltersSchema>
export type AgentSavedView = SavedView<AgentViewFilters>
export const emptyAgentFilters: AgentViewFilters = { search: '', status: '', rank: '', unit: '', flag: '' }

export function readAgentViews(raw: string | null): AgentSavedView[] {
  return readSavedViews(raw, agentSavedViewsSchema)
}

export function sameAgentFilters(a: AgentViewFilters, b: AgentViewFilters) {
  return sameFilters(a, b, emptyAgentFilters)
}
