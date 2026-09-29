'use client'

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { LIVE_REFRESH_INTERVAL_MS, LIVE_UPDATE_CHANNEL, LIVE_UPDATE_EVENT } from '@/lib/live-updates'

/**
 * True, wenn der Nutzer gerade in einem editierbaren Element tippt (Input,
 * Textarea, Select oder contentEditable). Der stille Hintergrund-Refetch würde
 * sonst `data` überschreiben und Formulare/Editoren, die ihren Bearbeitungs-State
 * aus `data` seeden, während des Tippens zurücksetzen — Eingaben gingen verloren.
 * Explizite refetch()-Aufrufe (z. B. nach dem Speichern) sind davon NICHT betroffen.
 */
function isEditingActiveElement(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable === true
}

interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  setData: Dispatch<SetStateAction<T | null>>
}

export function useFetch<T>(url: string | null, refreshInterval = LIVE_REFRESH_INTERVAL_MS): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const pendingRef = useRef(false)
  const lastBackgroundRefresh = useRef(0)

  const fetchData = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    if (!url) {
      requestIdRef.current += 1
      setError(null)
      setLoading(false)
      setData(null)
      return
    }

    // Coalesce focus/visibility/live-update bursts, without delaying explicit saves.
    if (options?.silent && !options.force && (pendingRef.current || Date.now() - lastBackgroundRefresh.current < 1000)) return
    lastBackgroundRefresh.current = Date.now()
    pendingRef.current = true
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!options?.silent) {
      setLoading(true)
    }
    setError(null)
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Fehler beim Laden')
      }
      if (requestIdRef.current === requestId) {
        setData(json.data)
      }
    } catch (e) {
      if (requestIdRef.current === requestId) {
        setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
      }
    } finally {
      if (requestIdRef.current === requestId) {
        pendingRef.current = false
        setLoading(false)
      }
    }
  }, [url])

  useEffect(() => {
    void fetchData()
    return () => {
      requestIdRef.current += 1
      pendingRef.current = false
    }
  }, [fetchData])

  useEffect(() => {
    if (!url) {
      return
    }

    const refreshSilently = () => {
      if (document.visibilityState === 'visible' && !isEditingActiveElement()) {
        void fetchData({ silent: true })
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isEditingActiveElement()) {
        void fetchData({ silent: true })
      }
    }

    // Mutations must not be swallowed by a recent or ongoing background refresh.
    // Debounce the local event and BroadcastChannel copy into one fresh request.
    let liveUpdateTimer: number | undefined
    const handleLiveUpdate = () => {
      window.clearTimeout(liveUpdateTimer)
      liveUpdateTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && !isEditingActiveElement()) {
          void fetchData({ silent: true, force: true })
        }
      }, 100)
    }

    const channel = 'BroadcastChannel'  in window ? new BroadcastChannel(LIVE_UPDATE_CHANNEL) : null

    window.addEventListener('focus', refreshSilently)
    window.addEventListener(LIVE_UPDATE_EVENT, handleLiveUpdate)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    channel?.addEventListener('message', handleLiveUpdate)

    const intervalId = window.setInterval(refreshSilently, refreshInterval)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(liveUpdateTimer)
      window.removeEventListener('focus', refreshSilently)
      window.removeEventListener(LIVE_UPDATE_EVENT, handleLiveUpdate)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      channel?.removeEventListener('message', handleLiveUpdate)
      channel?.close()
    }
  }, [fetchData, url, refreshInterval])

  const refetch = useCallback(() => fetchData(), [fetchData])

  return { data, loading, error, refetch, setData }
}
