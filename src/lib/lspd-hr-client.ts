import 'server-only'

import { lspdConfig } from '@/lib/lspd-hr-client-config'
import type { LspdOfficer, LspdOfficerFile } from '@/lib/lspd-officers'

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

  if (response.status === 404) throw new LspdUnavailableError('Beamter im LSPD-Panel nicht gefunden.', 404)
  if (response.status === 401) throw new LspdUnavailableError('Das LSPD-Panel hat das Secret abgelehnt.', 502)
  if (!response.ok) throw new LspdUnavailableError(`Das LSPD-Panel antwortet mit Status ${response.status}.`, 502)

  const body = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null
  if (!body?.success || body.data === undefined) {
    throw new LspdUnavailableError(body?.error || 'Unerwartete Antwort vom LSPD-Panel.', 502)
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(path, { at: Date.now(), data: body.data })
  return body.data
}

export function searchLspdOfficers(options: { q?: string; status?: string[]; limit?: number } = {}) {
  const params = new URLSearchParams()
  if (options.q?.trim()) params.set('q', options.q.trim().slice(0, 100))
  if (options.status?.length) params.set('status', options.status.join(','))
  params.set('limit', String(Math.min(Math.max(options.limit ?? 25, 1), 100)))
  return request<LspdOfficer[]>(`/api/external/officers?${params}`)
}

export function getLspdOfficerFile(id: string) {
  return request<LspdOfficerFile>(`/api/external/officers/${encodeURIComponent(id)}`)
}

/** Wie `getLspdOfficerFile`, aber `null` statt Fehler – für optionale Anzeige. */
export async function tryGetLspdOfficerFile(id: string) {
  try {
    return await getLspdOfficerFile(id)
  } catch {
    return null
  }
}
