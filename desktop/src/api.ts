import { invoke } from '@tauri-apps/api/core'

// Zugang zu den Dashboard-APIs über Rust (der Token verlässt den Hauptprozess nie).
// Pfade wie im Dashboard, z. B. `/api/investigations/abc`.

function call<T>(method: string, path: string, body?: unknown) {
  return invoke<T>('api_call', { method, path, body: body ?? null })
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  del: <T = unknown>(path: string, body?: unknown) => call<T>('DELETE', path, body),
  /** Bild als Data-URL. */
  image: (path: string) => invoke<string>('api_image', { path }),
  /** Datei in den Cache laden, liefert den lokalen Pfad. */
  download: (path: string, name: string) => invoke<string>('api_download', { path, name }),
}

export function query(params: Record<string, string | undefined | null | false>) {
  const entries = Object.entries(params).filter(([, v]) => v) as [string, string][]
  return entries.length ? `?${new URLSearchParams(entries)}` : ''
}
