import { EyeOff } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  INVESTIGATION_ENTRY_KIND_LABELS,
  INVESTIGATION_PERSON_ROLE_LABELS,
  INVESTIGATION_PRIORITY_LABELS,
  INVESTIGATION_STATUS_LABELS,
  type InvestigationEntryKindKey,
  type InvestigationPersonRoleKey,
  type InvestigationPriorityKey,
  type InvestigationStatusKey,
} from '@/lib/investigations'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

const STATUS_VARIANTS: Record<InvestigationStatusKey, BadgeVariant> = {
  OPEN: 'info',
  ACTIVE: 'warning',
  SUSPENDED: 'default',
  CLOSED: 'success',
  ARCHIVED: 'default',
}

const PRIORITY_VARIANTS: Record<InvestigationPriorityKey, BadgeVariant> = {
  LOW: 'default',
  NORMAL: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

const ROLE_VARIANTS: Record<InvestigationPersonRoleKey, BadgeVariant> = {
  SUSPECT: 'danger',
  WITNESS: 'info',
  VICTIM: 'warning',
  INFORMANT: 'default',
  ACCOMPLICE: 'danger',
  OTHER: 'default',
}

export function StatusBadge({ status }: { status: InvestigationStatusKey }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{INVESTIGATION_STATUS_LABELS[status]}</Badge>
}

export function PriorityBadge({ priority }: { priority: InvestigationPriorityKey }) {
  return <Badge variant={PRIORITY_VARIANTS[priority]}>{INVESTIGATION_PRIORITY_LABELS[priority]}</Badge>
}

export function RoleBadge({ role }: { role: InvestigationPersonRoleKey }) {
  return <Badge variant={ROLE_VARIANTS[role]}>{INVESTIGATION_PERSON_ROLE_LABELS[role]}</Badge>
}

export function EntryKindBadge({ kind }: { kind: InvestigationEntryKindKey }) {
  return <Badge variant="default">{INVESTIGATION_ENTRY_KIND_LABELS[kind]}</Badge>
}

export function ClassifiedBadge() {
  return (
    <Badge variant="danger" className="gap-1">
      <EyeOff className="h-3 w-3" />
      Verschlusssache
    </Badge>
  )
}

/** Auswahloptionen für die Filter- und Formular-Selects. */
export function labelOptions<T extends Record<string, string>>(labels: T) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}
