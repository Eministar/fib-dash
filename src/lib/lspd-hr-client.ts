import 'server-only'

import { lspdConfig } from '@/lib/lspd-hr-client-config'
import { normalizeLspdOfficer, type LspdOfficer, type LspdOfficerFile } from '@/lib/lspd-officers'

export { lspdConfig }

/**
 * Zugriff auf die externe Officer-API des lspd-hr-Panels. Das Secret bleibt
 * auf dem Server; der Browser spricht nur mit `/api/lspd/officers`.
 */

const TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 60_000
const CACHE_MAX = 300

export class LspdUnavailableError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message)
    this.name = 'LspdUnavailableError'
  }
}

export function isLspdConfigured() {
  return lspdConfig() !== null
}

const cache = new Map<string, { at: number; data: unknown }>()

async function request<T>(path: string): Promise<T> {
  const config = lspdConfig()
  if (!config) throw new LspdUnavailableError('Die Anbindung an das LSPD-Panel ist nicht eingerichtet.')

  const cached = cache.get(path)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data as T

  let response: Response
  try {
    response = await fetch(`${config.url}${path}`, {
      headers: { 'x-api-secret': config.secret, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new LspdUnavailableError('Das LSPD-Panel ist gerade nicht erreichbar.')
  }

  const fail = (message: string, status = 502): never => {
    // Ins Server-Log mit Ziel und Status – die Oberfläche zeigt nur die Meldung.
    console.error(`[lspd-hr] ${response.status} ${config.url}${path.split('?')[0]}: ${message}`)
    throw new LspdUnavailableError(message, status)
  }

  if (response.status === 401) {
    fail('Das LSPD-Panel lehnt das Secret ab: LSPD_HR_API_SECRET (fib-dash) muss exakt FIB_API_SECRET (LSPD-Panel) entsprechen.')
  }
  if (response.status === 503) {
    fail('Im LSPD-Panel ist FIB_API_SECRET nicht gesetzt oder kürzer als 24 Zeichen (danach das Panel neu starten).')
  }
  if (response.status === 404) {
    // Beim Einzelabruf heißt 404 „Beamter fehlt“; bei der Suche fehlt die Schnittstelle selbst.
    if (path.startsWith('/api/external/officers/')) fail('Beamter im LSPD-Panel nicht gefunden.', 404)
    fail('Schnittstelle im LSPD-Panel nicht gefunden: Ist lspd-hr aktualisiert und zeigt LSPD_HR_API_URL auf das Panel?')
  }
  if (!response.ok) fail(`Das LSPD-Panel antwortet mit Status ${response.status}.`)

  const raw = await response.text().catch(() => '')
  let body: { success?: boolean; data?: T; error?: string } | null = null
  try {
    body = JSON.parse(raw)
  } catch {
    fail('Keine gültige Antwort vom LSPD-Panel (kein JSON): LSPD_HR_API_URL zeigt vermutlich auf eine andere Seite oder einen Login.')
  }
  if (!body?.success || body.data === undefined) fail(body?.error || 'Unerwartete Antwort vom LSPD-Panel.')
  const data = body!.data as T

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(path, { at: Date.now(), data })
  return data
}

export function searchLspdOfficers(options: { q?: string; status?: string[]; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.q?.trim()) params.set('q', options.q.trim().slice(0, 100))
  if (options.status?.length) params.set('status', options.status.join(','))
  params.set('limit', String(Math.min(Math.max(options.limit ?? 25, 1), 100)))
  return request<LspdOfficer[]>(`/api/external/officers?${params}`).then((list) => list.map(normalizeLspdOfficer))
}

export function getLspdOfficerFile(id: string) {
  return request<LspdOfficerFile>(`/api/external/officers/${encodeURIComponent(id)}`).then(normalizeLspdOfficer)
}

/** Wie `getLspdOfficerFile`, aber `null` statt Fehler – für optionale Anzeige. */
export async function tryGetLspdOfficerFile(id: string) {
  try {
    return await getLspdOfficerFile(id)
  } catch {
    return null
  }
}
