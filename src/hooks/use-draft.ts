'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/auth-context'

const SAVE_DELAY_MS = 800
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

type StoredDraft<T> = { value: T; savedAt: number }

/**
 * Speichert lange Eingaben laufend im Browser. Stürzt der Tab ab, wird er
 * geschlossen oder läuft die Sitzung ab, bietet das Formular beim nächsten
 * Öffnen „Entwurf wiederherstellen“ an. Nach dem Speichern `clearDraft()`
 * aufrufen (Rückgabewert).
 *
 * `key = null` schaltet den Entwurf aus (z. B. solange nichts geladen ist).
 * `isEmpty` entscheidet, ob sich das Aufheben überhaupt lohnt.
 */
export function useDraft<T>(
  key: string | null,
  value: T,
  onRestore: (value: T) => void,
  isEmpty: (value: T) => boolean,
) {
  const { user } = useAuth()
  const { addToast, removeToast } = useToast()
  const storageKey = key ? `fib:draft:${user?.id ?? 'guest'}:${key}` : null
  const json = JSON.stringify(value)

  // Stand beim Öffnen bzw. nach dem letzten Speichern. Solange das Formular
  // diesem Stand entspricht, wird nichts gesichert – und ein älterer Entwurf
  // nicht überschrieben.
  const [baseline, setBaseline] = useState({ key: storageKey, json })
  if (baseline.key !== storageKey) setBaseline({ key: storageKey, json })
  const baselineJson = baseline.key === storageKey ? baseline.json : json

  const offered = useRef<string | null>(null)
  const skipNextSave = useRef(false)
  const restoreRef = useRef(onRestore)
  const emptyRef = useRef(isEmpty)
  useEffect(() => {
    restoreRef.current = onRestore
    emptyRef.current = isEmpty
  })

  // Beim Öffnen: vorhandenen Entwurf anbieten (einmal pro Schlüssel).
  useEffect(() => {
    if (!storageKey || offered.current === storageKey) return
    offered.current = storageKey
    let stored: StoredDraft<T> | null = null
    try {
      const raw = localStorage.getItem(storageKey)
      stored = raw ? (JSON.parse(raw) as StoredDraft<T>) : null
    } catch {
      return
    }
    if (!stored || Date.now() - stored.savedAt > MAX_AGE_MS || emptyRef.current(stored.value)) return
    // Entwurf entspricht dem, was ohnehin im Formular steht → nichts anzubieten.
    if (JSON.stringify(stored.value) === baselineJson) return
    const draft = stored.value
    const time = new Date(stored.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
    const toastId = addToast({
      type: 'info',
      title: 'Ungespeicherter Entwurf gefunden',
      message: `Stand ${time}`,
      duration: 12_000,
      action: {
        label: 'Wiederherstellen',
        onClick: () => {
          skipNextSave.current = true
          restoreRef.current(draft)
        },
      },
    })
    return () => removeToast(toastId)
  }, [addToast, removeToast, storageKey, baselineJson])

  // Laufend (verzögert) sichern – aber erst, wenn sich etwas geändert hat.
  useEffect(() => {
    if (!storageKey) return
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    if (json === baselineJson) return
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(json) as T
        if (emptyRef.current(parsed)) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, JSON.stringify({ value: parsed, savedAt: Date.now() } satisfies StoredDraft<T>))
      } catch { /* Speicher voll oder gesperrt – dann eben ohne Entwurf. */ }
    }, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [storageKey, json, baselineJson])

  return useCallback(() => {
    if (!storageKey) return
    setBaseline({ key: storageKey, json })
    try { localStorage.removeItem(storageKey) } catch { /* egal */ }
  }, [storageKey, json])
}
