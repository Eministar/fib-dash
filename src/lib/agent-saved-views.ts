import { z } from 'zod'

export const agentViewFiltersSchema = z.object({
  search: z.string().max(200),
  status: z.enum(['', 'ACTIVE', 'AWAY', 'ON_LEAVE', 'INACTIVE']),
  rank: z.string().max(191),
  unit: z.string().max(191),
  flag: z.enum(['', '__any__', 'RED', 'ORANGE', 'YELLOW', 'BLUE', 'PURPLE']),
})
export const agentSavedViewsSchema = z.array(z.object({
  id: z.string().max(100),
  name: z.string().trim().min(1).max(50),
  filters: agentViewFiltersSchema,
})).max(20)
export type AgentViewFilters = z.infer<typeof agentViewFiltersSchema>
export type AgentSavedView = z.infer<typeof agentSavedViewsSchema>[number]
export const emptyAgentFilters: AgentViewFilters = { search: '', status: '', rank: '', unit: '', flag: '' }

export function readAgentViews(raw: string | null): AgentSavedView[] {
  try {
    const result = agentSavedViewsSchema.safeParse(JSON.parse(raw ?? '[]'))
    return result.success ? result.data : []
  } catch { return [] }
}

export function sameAgentFilters(a: AgentViewFilters, b: AgentViewFilters) {
  return (Object.keys(emptyAgentFilters) as (keyof AgentViewFilters)[]).every(key => a[key] === b[key])
}
