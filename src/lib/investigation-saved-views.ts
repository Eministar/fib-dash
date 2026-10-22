import { INVESTIGATION_PRIORITY_LABELS, INVESTIGATION_STATUS_LABELS } from '@/lib/investigations'
import { field, filterValidator, readSavedViews, sameFilters, validSavedViews, type SavedView } from '@/lib/saved-views'

const statuses = ['ALL', 'OPEN_ONLY', ...Object.keys(INVESTIGATION_STATUS_LABELS)] as ('ALL' | 'OPEN_ONLY' | keyof typeof INVESTIGATION_STATUS_LABELS)[]
const priorities = ['ALL', ...Object.keys(INVESTIGATION_PRIORITY_LABELS)] as ('ALL' | keyof typeof INVESTIGATION_PRIORITY_LABELS)[]

export type InvestigationViewFilters = {
  search: string
  status: (typeof statuses)[number]
  priority: (typeof priorities)[number]
  mine: boolean
}

export const validateInvestigationFilters = filterValidator<InvestigationViewFilters>({
  search: field.text(200),
  status: field.oneOf(statuses),
  priority: field.oneOf(priorities),
  mine: field.flag(),
})
export type InvestigationSavedView = SavedView<InvestigationViewFilters>
/** Entspricht der Voreinstellung der Liste („Nur laufende“). */
export const defaultInvestigationFilters: InvestigationViewFilters = { search: '', status: 'OPEN_ONLY', priority: 'ALL', mine: false }

export function readInvestigationViews(raw: string | null): InvestigationSavedView[] {
  return readSavedViews(raw, validateInvestigationFilters)
}

export function validInvestigationViews(views: unknown): views is InvestigationSavedView[] {
  return validSavedViews(views, validateInvestigationFilters)
}

export function sameInvestigationFilters(a: InvestigationViewFilters, b: InvestigationViewFilters) {
  return sameFilters(a, b, defaultInvestigationFilters)
}
