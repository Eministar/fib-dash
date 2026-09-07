'use client'

import { useState, useCallback } from 'react'
import { notifyLiveUpdate } from '@/lib/live-updates'

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
      const res = await fetch(url, {
        ...options,
        cache: 'no-store',
        // include credentials to ensure cookies are sent in cross-origin/same-site setups
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      })

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
          // Server hat kein JSON geliefert (z.B. Next.js Fehlerseite).
          // Nutze den Rohtext für die Fehlermeldung.
          throw new Error(text)
        }
      }

      // Nun haben wir entweder ein geparstes JSON-Objekt oder null.
      const parsed = json as { success?: boolean; error?: string; data?: T } | null
      if (!res.ok || !parsed || !parsed.success) {
        throw new Error(parsed?.error || 'Fehler bei der Anfrage')
      }
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
