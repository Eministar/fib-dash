'use client'

import { useEffect, useState } from 'react'

/**
 * Liefert `value` erst, wenn er `delay` ms lang unverändert war. Für
 * Server-Suchen: sonst geht bei jedem Tastendruck eine Anfrage raus und die
 * Liste flackert beim Tippen.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
