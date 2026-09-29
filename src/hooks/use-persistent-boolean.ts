'use client'

import { useCallback, useSyncExternalStore } from 'react'

const preferenceEvent = 'fib:preference-changed'
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify)
  window.addEventListener(preferenceEvent, notify)
  return () => {
    window.removeEventListener('storage', notify)
    window.removeEventListener(preferenceEvent, notify)
  }
}
const memory = new Map<string, boolean>()

/** Shared between desktop/mobile; storage failures never disable the control. */
export function usePersistentBoolean(key: string, defaultValue: boolean) {
  const read = useCallback(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved === 'true' || saved === 'false') return saved === 'true'
    } catch { /* Private browsing may block storage. */ }
    return memory.get(key) ?? defaultValue
  }, [key, defaultValue])
  const value = useSyncExternalStore(subscribe, read, () => defaultValue)
  const setValue = useCallback((next: boolean) => {
    memory.set(key, next)
    try { localStorage.setItem(key, String(next)) } catch { /* Keep session state. */ }
    window.dispatchEvent(new Event(preferenceEvent))
  }, [key])
  return [value, setValue] as const
}
