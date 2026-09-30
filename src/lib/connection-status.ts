'use client'

/**
 * Winziger globaler Speicher für den Verbindungszustand. `useFetch` meldet
 * jeden Erfolg und jedes Netzwerkproblem; das Banner in der Shell liest mit.
 * Bewusst ohne React-Kontext, damit auch Hooks außerhalb des Baums melden können.
 */

export type ConnectionState = {
  /** Letzte Anfrage scheiterte am Netz/Server (nicht an einer fachlichen Fehlermeldung). */
  failing: boolean
  /** Zeitpunkt der letzten erfolgreichen Antwort. */
  lastOkAt: number | null
}

const EVENT = 'fib:connection-changed'
let state: ConnectionState = { failing: false, lastOkAt: null }

export function getConnectionState(): ConnectionState {
  return state
}

export function subscribeConnection(notify: () => void) {
  window.addEventListener(EVENT, notify)
  return () => window.removeEventListener(EVENT, notify)
}

export function reportConnection(ok: boolean) {
  const next: ConnectionState = ok
    ? { failing: false, lastOkAt: Date.now() }
    : { failing: true, lastOkAt: state.lastOkAt }
  if (next.failing === state.failing && (!ok || next.lastOkAt === state.lastOkAt)) return
  state = next
  window.dispatchEvent(new Event(EVENT))
}

/** Fehler, die auf Netz oder Server hindeuten (kein JSON, fetch abgebrochen, 5xx). */
export function isConnectionError(cause: unknown, status?: number): boolean {
  if (status !== undefined && status >= 500) return true
  return cause instanceof TypeError || cause instanceof SyntaxError
}
