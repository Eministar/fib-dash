'use client'

import { useEffect, useRef, useState } from 'react'

const PAGE_ACTION_EVENT = 'fib:page-action'
const PARAM = 'action'

function readActionParam() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(PARAM)
}

function clearActionParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(PARAM)) return
  url.searchParams.delete(PARAM)
  // `history.replaceState` statt Router: kein Re-Render, kein neuer Verlaufseintrag.
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Startet eine Seitenaktion (z. B. „Anlage-Dialog öffnen“) aus der
 * Befehlspalette. Liegt die Zielseite schon offen, wird nur ein Event
 * gefeuert; sonst wird mit `?action=…` dorthin navigiert.
 */
export function startPageAction(path: string, action: string, navigate: (href: string) => void) {
  if (window.location.pathname === path) {
    window.dispatchEvent(new CustomEvent(PAGE_ACTION_EVENT, { detail: action }))
    return
  }
  navigate(`${path}?${PARAM}=${encodeURIComponent(action)}`)
}

/**
 * Gegenstück auf der Zielseite: ruft `handler` genau einmal auf, sobald die
 * Aktion angefordert wurde und die Seite bereit ist (`ready`, z. B. Daten und
 * Rechte geladen). Danach verschwindet der Parameter aus der URL, damit ein
 * Reload den Dialog nicht erneut öffnet.
 */
export function usePageAction(action: string, handler: () => void, ready = true) {
  const [pending, setPending] = useState(false)
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    // Erst nach dem Mounten lesen: `window` gibt es beim Server-Rendering nicht.
    if (readActionParam() === action) setPending(true)
    const onAction = (event: Event) => {
      if ((event as CustomEvent<string>).detail === action) setPending(true)
    }
    window.addEventListener(PAGE_ACTION_EVENT, onAction)
    return () => window.removeEventListener(PAGE_ACTION_EVENT, onAction)
  }, [action])

  useEffect(() => {
    if (!pending || !ready) return
    setPending(false)
    if (readActionParam() === action) clearActionParam()
    handlerRef.current()
  }, [action, pending, ready])
}
