'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/ui/toast'

const UNDO_WINDOW_MS = 5_000

type UndoableAction = {
  /** Toast-Text, z. B. „Aufgabe gelöscht“. */
  title: string
  message?: string
  /** Sofort ausgeführt: blendet den Eintrag in der Oberfläche aus. */
  apply: () => void
  /** Macht `apply` rückgängig, wenn der Benutzer „Rückgängig“ klickt oder `commit` scheitert. */
  revert: () => void
  /** Die eigentliche Serveranfrage – läuft erst nach Ablauf des Fensters. */
  commit: () => Promise<unknown>
  /** Meldung, falls `commit` scheitert. */
  errorTitle?: string
}

/**
 * „Rückgängig“ statt „Wirklich löschen?“: Die Aktion wirkt sofort in der
 * Oberfläche, die Anfrage an den Server geht aber erst nach fünf Sekunden
 * raus. Wer die Seite vorher verlässt, löst sie sofort aus – verloren geht
 * nichts, und ein versehentlicher Klick kostet nur einen zweiten.
 */
export function useUndoable() {
  const { addToast } = useToast()
  const pending = useRef(new Map<number, () => void>())
  const nextId = useRef(0)

  // Beim Verlassen der Seite (Navigation oder Tab schließen) alles Offene sofort abschicken.
  useEffect(() => {
    const queue = pending.current
    const flushAll = () => {
      queue.forEach((flush) => flush())
      queue.clear()
    }
    window.addEventListener('pagehide', flushAll)
    return () => {
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [])

  return useCallback((action: UndoableAction) => {
    const id = nextId.current++
    let settled = false

    const flush = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      pending.current.delete(id)
      action.commit().catch((cause: unknown) => {
        action.revert()
        addToast({
          type: 'error',
          title: action.errorTitle ?? 'Aktion fehlgeschlagen',
          message: cause instanceof Error ? cause.message : undefined,
        })
      })
    }

    const undo = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      pending.current.delete(id)
      action.revert()
    }

    action.apply()
    const timer = window.setTimeout(flush, UNDO_WINDOW_MS)
    pending.current.set(id, flush)

    addToast({
      type: 'success',
      title: action.title,
      message: action.message,
      duration: UNDO_WINDOW_MS,
      action: { label: 'Rückgängig', onClick: undo },
    })
  }, [addToast])
}

/**
 * Merkt sich IDs, die in der Oberfläche schon verschwunden sind, deren
 * Löschung aber noch aussteht. Filtert unabhängig vom Datenstand – ein
 * Hintergrund-Refresh von `useFetch` holt den Eintrag also nicht zurück.
 */
export function useHiddenIds() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const hide = useCallback((id: string) => setHidden((prev) => new Set(prev).add(id)), [])
  const show = useCallback((id: string) => setHidden((prev) => {
    const next = new Set(prev)
    next.delete(id)
    return next
  }), [])
  return { hidden, hide, show }
}
