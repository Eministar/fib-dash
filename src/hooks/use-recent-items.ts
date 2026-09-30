'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { useAuth } from '@/context/auth-context'

export type RecentItemKind = 'agent' | 'investigation' | 'dossier' | 'person' | 'rank-change' | 'ordnung' | 'publication'

export type RecentItem = {
  href: string
  title: string
  /** Kurzer Zusatz, z. B. Dienstnummer oder Aktenzeichen. */
  subtitle?: string
  kind: RecentItemKind
  visitedAt: number
}

export const RECENT_KIND_LABELS: Record<RecentItemKind, string> = {
  agent: 'Agent',
  investigation: 'Einsatzakte',
  dossier: 'Dauerakte',
  person: 'Person',
  'rank-change': 'Rangänderung',
  ordnung: 'Ordnung',
  publication: 'Aushang',
}

const MAX_ITEMS = 8
const CHANGE_EVENT = 'fib:recent-items-changed'
const EMPTY: RecentItem[] = []

function storageKey(userId: string | undefined) {
  return `fib:recent:${userId ?? 'guest'}`
}

// useSyncExternalStore verlangt stabile Snapshots: gleicher String → gleiches Array.
const cache = new Map<string, { raw: string; items: RecentItem[] }>()

function read(key: string): RecentItem[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return EMPTY
  }
  if (!raw) return EMPTY
  const cached = cache.get(key)
  if (cached?.raw === raw) return cached.items
  try {
    const parsed = JSON.parse(raw) as unknown
    const items = Array.isArray(parsed)
      ? parsed.filter((item): item is RecentItem => typeof item?.href === 'string' && typeof item?.title === 'string')
      : EMPTY
    cache.set(key, { raw, items })
    return items
  } catch {
    return EMPTY
  }
}

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(CHANGE_EVENT, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(CHANGE_EVENT, notify)
  }
}

/** Zuletzt geöffnete Akten und Personen – nur in diesem Browser, pro Benutzer. */
export function useRecentItems(): RecentItem[] {
  const { user } = useAuth()
  const key = storageKey(user?.id)
  return useSyncExternalStore(subscribe, () => read(key), () => EMPTY)
}

export function useRecordRecentItem() {
  const { user } = useAuth()
  const key = storageKey(user?.id)
  return useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    const next = [
      { ...item, visitedAt: Date.now() },
      ...read(key).filter((existing) => existing.href !== item.href),
    ].slice(0, MAX_ITEMS)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      return
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [key])
}

/** Merkt sich eine Detailseite, sobald ihre Daten da sind. `null` = noch nicht geladen. */
export function useTrackRecentItem(item: Omit<RecentItem, 'visitedAt'> | null) {
  const record = useRecordRecentItem()
  const href = item?.href
  const title = item?.title
  const subtitle = item?.subtitle
  const kind = item?.kind
  useEffect(() => {
    if (!href || !title || !kind) return
    record({ href, title, subtitle, kind })
  }, [href, title, subtitle, kind, record])
}
