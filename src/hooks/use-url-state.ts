'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const URL_SYNC_DELAY_MS = 250

/**
 * Wie `useState<string>`, aber der Wert steht zusätzlich in der URL
 * (`?q=…&status=…`). Dadurch überleben Suche und Filter ein Neuladen, die
 * Zurück-Taste und lassen sich als Link weitergeben.
 *
 * Getippt wird gegen den lokalen State; die URL zieht leicht verzögert per
 * `history.replaceState` nach – ohne Navigation und ohne neuen
 * Verlaufseintrag pro Tastendruck. Der Standardwert steht nie in der URL.
 *
 * `allowed` schützt vor erfundenen Werten aus alten oder geteilten Links.
 */
export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>,
  allowed?: readonly NoInfer<T>[],
): [T, (next: T) => void] {
  const searchParams = useSearchParams()

  const [value, setValue] = useState<T>(() => {
    const raw = searchParams.get(key)
    if (raw === null) return defaultValue
    if (allowed && !allowed.includes(raw as T)) return defaultValue
    return raw as T
  })
  const timer = useRef<number | undefined>(undefined)

  const update = useCallback((next: T) => {
    setValue(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (next === defaultValue || next === '') url.searchParams.delete(key)
      else url.searchParams.set(key, next)
      if (url.href !== window.location.href) {
        window.history.replaceState(window.history.state, '', url)
      }
    }, URL_SYNC_DELAY_MS)
  }, [defaultValue, key])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return [value, update]
}
