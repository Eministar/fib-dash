import { isInvestigationEntryKind, type InvestigationEntryKindKey } from './investigations'

/**
 * Chronologie-Einträge, die noch nicht gespeichert sind – z. B. von der KI
 * beim Anlegen einer Akte vorgeschlagen. Reine Funktionen, Browser und Server.
 */
export type DraftEntry = { title: string; content: string; kind: InvestigationEntryKindKey }

export const MAX_DRAFT_ENTRIES = 12

export function readDraftEntries(value: unknown): DraftEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, 4000) : ''
    const kind = typeof raw.kind === 'string' ? raw.kind.trim().toUpperCase() : ''
    if (!title || !content) return []
    return [{ title, content, kind: isInvestigationEntryKind(kind) ? kind : 'NOTE' as const }]
  }).slice(0, MAX_DRAFT_ENTRIES)
}
