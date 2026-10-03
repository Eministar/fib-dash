'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { useAuth } from '@/context/auth-context'

const CHANGE_EVENT = 'fib:nav-favorites-changed'
const EMPTY: string[] = []

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(CHANGE_EVENT, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(CHANGE_EVENT, notify)
  }
}

// useSyncExternalStore verlangt stabile Snapshots: gleicher String → gleiches Array.
const cache = new Map<string, { raw: string; hrefs: string[] }>()
const memory = new Map<string, string[]>()

function read(key: string): string[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? EMPTY
  }
  if (!raw) return memory.get(key) ?? EMPTY
  const cached = cache.get(key)
  if (cached?.raw === raw) return cached.hrefs
  try {
    const parsed = JSON.parse(raw) as unknown
    const hrefs = Array.isArray(parsed) ? parsed.filter((href): href is string => typeof href === 'string') : EMPTY
    cache.set(key, { raw, hrefs })
    return hrefs
  } catch {
    return EMPTY
  }
}

/** Angeheftete Seiten der Navigation – nur in diesem Browser, pro Benutzer, in Anheft-Reihenfolge. */
export function useNavFavorites() {
  const { user } = useAuth()
  const key = `fib:nav-favorites:${user?.id ?? 'guest'}`
  const favorites = useSyncExternalStore(subscribe, () => read(key), () => EMPTY)

  const toggle = useCallback((href: string) => {
    const current = read(key)
    const next = current.includes(href) ? current.filter((item) => item !== href) : [...current, href]
    memory.set(key, next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch { /* Sitzungsstand bleibt erhalten. */ }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [key])

  return { favorites, toggle }
}
