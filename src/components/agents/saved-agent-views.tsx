'use client'

import { SavedViews } from '@/components/ui/saved-views'
import { readAgentViews, sameAgentFilters, emptyAgentFilters, validAgentViews, type AgentViewFilters } from '@/lib/agent-saved-views'

export function SavedAgentViews({ userId, filters, onApply }: { userId: string; filters: AgentViewFilters; onApply: (filters: AgentViewFilters) => void }) {
  return <SavedViews
    storageKey={`fib:agent-views:${userId}`}
    filters={filters}
    defaults={emptyAgentFilters}
    onApply={onApply}
    read={readAgentViews}
    same={sameAgentFilters}
    validate={validAgentViews}
    defaultLabel="Alle Agents"
    placeholder="Zum Beispiel Agents in Ausbildung"
    hint="Speichert Suche, Status, Rang, Unit und Markierung für dein Konto in diesem Browser."
  />
}
