'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Zahl, die kurz aufleuchtet, wenn sie sich durch ein Live-Update ändert –
 * so sieht man, *was* sich gerade bewegt hat, ohne die Seite abzusuchen.
 * Beim ersten Rendern bleibt sie ruhig.
 */
export function LiveNumber({ value }: { value: number | string }) {
  const previous = useRef(value)
  const [flashKey, setFlashKey] = useState(0)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setFlashKey((key) => key + 1)
  }, [value])

  return (
    <span key={flashKey} className={flashKey > 0 ? 'live-number-flash' : undefined}>
      {value}
    </span>
  )
}
