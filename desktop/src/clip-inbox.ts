import type { ClipInfo } from './backend'

export type InboxClip = ClipInfo & {
  draft?: { fields: Record<string, string>; duration: number; start: number; end: number }
  uploadState?: 'waiting' | 'uploading' | 'failed'
  failure?: string
}

export function readInbox(raw: string | null): InboxClip[] {
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Der gespeicherte Posteingang ist beschädigt.')
  return parsed.filter((item): item is InboxClip => !!item && typeof item.path === 'string' && typeof item.name === 'string' && Number.isFinite(item.savedAt) && Number.isFinite(item.sizeBytes))
    .map(item => item.uploadState === 'uploading' ? { ...item, uploadState: 'failed', failure: 'Upload unterbrochen. Bitte vor dem Wiederholen prüfen, ob der Clip bereits angekommen ist.' } : item)
}
