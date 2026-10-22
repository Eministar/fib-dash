import { z } from 'zod'
import { INVESTIGATION_PRIORITY_LABELS, INVESTIGATION_STATUS_LABELS } from '@/lib/investigations'
import { readSavedViews, sameFilters, savedViewsSchema, type SavedView } from '@/lib/saved-views'

const statuses = Object.keys(INVESTIGATION_STATUS_LABELS) as (keyof typeof INVESTIGATION_STATUS_LABELS)[]
const priorities = Object.keys(INVESTIGATION_PRIORITY_LABELS) as (keyof typeof INVESTIGATION_PRIORITY_LABELS)[]

export const investigationViewFiltersSchema = z.object({
  search: z.string().max(200),
  status: z.enum(['ALL', 'OPEN_ONLY', ...statuses]),
  priority: z.enum(['ALL', ...priorities]),
  mine: z.boolean(),
})
export const investigationSavedViewsSchema = savedViewsSchema(investigationViewFiltersSchema)
export type InvestigationViewFilters = z.infer<typeof investigationViewFiltersSchema>
export type InvestigationSavedView = SavedView<InvestigationViewFilters>
/** Entspricht der Voreinstellung der Liste („Nur laufende“). */
export const defaultInvestigationFilters: InvestigationViewFilters = { search: '', status: 'OPEN_ONLY', priority: 'ALL', mine: false }

export function readInvestigationViews(raw: string | null): InvestigationSavedView[] {
  return readSavedViews(raw, investigationSavedViewsSchema)
}

export function sameInvestigationFilters(a: InvestigationViewFilters, b: InvestigationViewFilters) {
  return sameFilters(a, b, defaultInvestigationFilters)
}
