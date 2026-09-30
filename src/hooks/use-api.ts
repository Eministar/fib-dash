'use client'

import { useState, useCallback } from 'react'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { reportConnection } from '@/lib/connection-status'

/** Verständliche Meldung für Antworten ohne JSON (Proxy-Fehlerseiten, Upload-Limits …). */
function statusMessage(status: number): string {
  if (status === 401) return 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.'
  if (status === 403) return 'Dafür fehlt dir die Berechtigung.'
  if (status === 404) return 'Der Eintrag wurde nicht gefunden – eventuell wurde er gerade gelöscht.'
  if (status === 413) return 'Die Datei ist zu groß für den Server.'
  if (status === 429) return 'Zu viele Anfragen – bitte kurz warten und erneut versuchen.'
  if (status >= 500) return `Der Server hat einen Fehler gemeldet (${status}). Bitte versuch es gleich noch einmal.`
  return `Unerwartete Antwort vom Server (Status ${status}).`
}

interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  execute: (url: string, options?: RequestInit) => Promise<T | null>
}

export function useApi<T = unknown>(): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (url: string, options?: RequestInit): Promise<T | null> => {
    setLoading(true)
    setError(null)
    try {
      const method = options?.method?.toUpperCase() ?? 'GET'
      let res: Response
      try {
        res = await fetch(url, {
          ...options,
          cache: 'no-store',
          // include credentials to ensure cookies are sent in cross-origin/same-site setups
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...options?.headers },
        })
      } catch {
        reportConnection(false)
        throw new Error('Keine Verbindung zum Server. Deine Eingaben sind noch da – bitte erneut versuchen.')
      }
      if (res.status >= 502) reportConnection(false)

      // Robuste Fehlerbehandlung: manche Endpunkte oder Fehlerseiten liefern
      // kein JSON (z.B. Next.js Fehlerseiten). Versuche JSON zu parsen, und
      // falls das fehlschlägt, lese die Roh-Text-Antwort und verwende sie als
      // Fehlermeldung, damit der Client nicht mit "Unexpected token" abstürzt.
      const text = await res.text().catch(() => '')
      let json: unknown = null
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          // Server hat kein JSON geliefert (z.B. Next.js- oder Proxy-Fehlerseite).
          // Den HTML-Rohtext NICHT anzeigen – der landete sonst komplett im Toast.
          throw new Error(statusMessage(res.status))
        }
      }

      // Nun haben wir entweder ein geparstes JSON-Objekt oder null.
      const parsed = json as { success?: boolean; error?: string; data?: T } | null
      if (!res.ok || !parsed || !parsed.success) {
        throw new Error(parsed?.error || statusMessage(res.status))
      }
      reportConnection(true)
      if (method !== 'GET' && method !== 'HEAD') {
        notifyLiveUpdate()
      }
      setData(parsed!.data as T)
      return parsed!.data as T
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler'
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, execute }
}
