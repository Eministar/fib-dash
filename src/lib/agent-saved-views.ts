import { field, filterValidator, readSavedViews, sameFilters, validSavedViews, type SavedView } from '@/lib/saved-views'

const AGENT_STATUSES = ['', 'ACTIVE', 'AWAY', 'ON_LEAVE', 'INACTIVE'] as const
const AGENT_FLAGS = ['', '__any__', 'RED', 'ORANGE', 'YELLOW', 'BLUE', 'PURPLE'] as const

export type AgentViewFilters = {
  search: string
  status: (typeof AGENT_STATUSES)[number]
  rank: string
  unit: string
  flag: (typeof AGENT_FLAGS)[number]
}

export const validateAgentFilters = filterValidator<AgentViewFilters>({
  search: field.text(200),
  status: field.oneOf(AGENT_STATUSES),
  rank: field.text(191),
  unit: field.text(191),
  flag: field.oneOf(AGENT_FLAGS),
})
export type AgentSavedView = SavedView<AgentViewFilters>
export const emptyAgentFilters: AgentViewFilters = { search: '', status: '', rank: '', unit: '', flag: '' }

export function readAgentViews(raw: string | null): AgentSavedView[] {
  return readSavedViews(raw, validateAgentFilters)
}

export function validAgentViews(views: unknown): views is AgentSavedView[] {
  return validSavedViews(views, validateAgentFilters)
}

export function sameAgentFilters(a: AgentViewFilters, b: AgentViewFilters) {
  return sameFilters(a, b, emptyAgentFilters)
}
