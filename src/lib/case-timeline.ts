/**
 * Fall-Zeitstrahl: führt alles, was in einer Akte einen Zeitpunkt hat, auf
 * einer Achse zusammen. Rein clientseitig aus den Daten der Akte.
 */

export const TIMELINE_KINDS = ['milestone', 'entry', 'clip', 'evidence', 'photo', 'custody'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  milestone: 'Akte',
  entry: 'Chronologie',
  clip: 'Bodycam',
  evidence: 'Asservate',
  photo: 'Bilder',
  custody: 'Beweiskette',
}

export interface TimelineItem {
  id: string
  kind: TimelineKind
  at: string
  title: string
  subtitle?: string | null
  /** Zeitpunkt ist nur geschätzt (z. B. Upload- statt Aufnahmezeit). */
  approximate?: boolean
  /** Bezug für Klicks: Clip-ID, Foto-ID, Asservat-ID … */
  refId?: string
}

export interface TimelineSource {
  createdAt: string
  closedAt: string | null
  entries: { id: string; kind: string; title: string; occurredAt: string; location: string | null }[]
  clips: { id: string; title: string; recordedAt: string | null; createdAt: string; location: string | null }[]
  evidence: {
    id: string
    itemNumber: string
    title: string
    seizedAt: string | null
    createdAt: string
    seizedLocation: string | null
  }[]
  photos: { id: string; title: string; createdAt: string }[]
}

export interface TimelineCustodyEvent {
  id: string
  evidenceId: string | null
  itemNumber: string
  action: string
  actorName: string
  toHolder: string | null
  location: string | null
  createdAt: string
}

/** Ansehen ist für die Fallgeschichte Rauschen – im Zeitstrahl nur Handlungen. */
const CUSTODY_TIMELINE_ACTIONS: Record<string, string> = {
  TRANSFERRED: 'übergeben',
  STATUS_CHANGED: 'Status geändert',
  DELETED: 'gelöscht',
}

export function buildCaseTimeline(
  source: TimelineSource,
  entryKindLabels: Record<string, string>,
  custody: TimelineCustodyEvent[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = [
    { id: 'milestone:created', kind: 'milestone', at: source.createdAt, title: 'Akte angelegt' },
  ]
  if (source.closedAt) {
    items.push({ id: 'milestone:closed', kind: 'milestone', at: source.closedAt, title: 'Akte abgeschlossen' })
  }

  for (const entry of source.entries) {
    items.push({
      id: `entry:${entry.id}`,
      kind: 'entry',
      at: entry.occurredAt,
      title: entry.title,
      subtitle: [entryKindLabels[entry.kind] ?? entry.kind, entry.location].filter(Boolean).join(' · '),
      refId: entry.id,
    })
  }

  for (const clip of source.clips) {
    items.push({
      id: `clip:${clip.id}`,
      kind: 'clip',
      at: clip.recordedAt ?? clip.createdAt,
      approximate: !clip.recordedAt,
      title: clip.title,
      subtitle: clip.location,
      refId: clip.id,
    })
  }

  for (const item of source.evidence) {
    items.push({
      id: `evidence:${item.id}`,
      kind: 'evidence',
      at: item.seizedAt ?? item.createdAt,
      approximate: !item.seizedAt,
      title: `${item.itemNumber} · ${item.title}`,
      subtitle: item.seizedLocation ? `Sichergestellt: ${item.seizedLocation}` : 'Sichergestellt',
      refId: item.id,
    })
  }

  for (const photo of source.photos) {
    items.push({
      id: `photo:${photo.id}`,
      kind: 'photo',
      at: photo.createdAt,
      approximate: true,
      title: photo.title,
      subtitle: 'Bild erfasst',
      refId: photo.id,
    })
  }

  for (const event of custody) {
    const label = CUSTODY_TIMELINE_ACTIONS[event.action]
    if (!label) continue
    const detail =
      event.action === 'TRANSFERRED'
        ? [event.toHolder && `an ${event.toHolder}`, event.location].filter(Boolean).join(' · ')
        : null
    items.push({
      id: `custody:${event.id}`,
      kind: 'custody',
      at: event.createdAt,
      title: `${event.itemNumber} ${label}`,
      subtitle: [detail, `durch ${event.actorName}`].filter(Boolean).join(' · '),
      refId: event.evidenceId ?? undefined,
    })
  }

  // Stabil sortiert: gleicher Zeitpunkt behält die Reihenfolge oben.
  return items
    .map((item, index) => ({ item, index, time: new Date(item.at).getTime() }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ item }) => item)
}

/** Kalendertag (Standard: Zeitzone des Browsers, wie `formatDateTime`). */
export function timelineDayKey(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  )
}

export function groupTimelineByDay(items: TimelineItem[], timeZone?: string) {
  const groups: { day: string; items: TimelineItem[] }[] = []
  for (const item of items) {
    const day = timelineDayKey(item.at, timeZone)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}
