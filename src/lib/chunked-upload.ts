'use client'

import type { UploadKind } from '@/lib/upload-kinds'

export type { UploadKind }

export interface UploadProgress {
  /** Bereits auf dem Server liegende Bytes, inklusive fortgesetzter. */
  sentBytes: number
  totalBytes: number
  percent: number
  /** Nur aus den in diesem Lauf übertragenen Bytes; 0, solange nichts fertig ist. */
  bytesPerSecond: number
  secondsRemaining: number | null
  /** true, wenn an eine angefangene Übertragung angeknüpft wurde. */
  resumed: boolean
}

export interface UploadTicket {
  uploadId: string
  sha256: string
  sizeBytes: number
}

const MAX_ATTEMPTS = 3

function concurrency() {
  const raw = Number.parseInt(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 3
}

/**
 * Erkennt dieselbe Datei bei einem späteren Versuch wieder.
 *
 * Gebildet wird der Abdruck nur aus Metadaten — ein Hash über 400 MB Inhalt
 * kostet im Browser mehr Zeit als der halbe Upload. Diese Metadaten wandern
 * aber durch SHA-256, statt im Klartext zu reisen: ein Dateiname darf 255
 * Zeichen lang sein, das Feld fasst 120. Vorher scheiterte der Upload an einem
 * langen Namen, und ein Abschneiden hätte Größe und Änderungsdatum verworfen —
 * zwei verschiedene Dateien mit gleichem Namensanfang wären dann als dieselbe
 * erkannt worden.
 */
export async function fingerprintFor(file: File) {
  const identity = `${file.name}:${file.size}:${file.lastModified}`
  return sha256Hex(new TextEncoder().encode(identity).buffer as ArrayBuffer)
}

async function sha256Hex(data: ArrayBuffer) {
  // `crypto.subtle` gibt es nur im sicheren Kontext. Ueber reines HTTP (ausser
  // localhost) ist es undefined — ohne diese Pruefung braeche der Upload mit
  // "Cannot read properties of undefined" ab, was niemandem weiterhilft.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Uploads benötigen eine HTTPS-Verbindung. Bitte die Seite über https:// öffnen.',
    )
  }
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function readJson(response: Response) {
  const parsed = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string; data?: unknown }
    | null

  if (!response.ok || !parsed?.success) {
    throw new Error(parsed?.error || `Upload fehlgeschlagen (HTTP ${response.status})`)
  }
  return parsed.data
}

interface SessionResponse {
  sessionId: string
  chunkSize: number
  chunkCount: number
  received: number[]
  resumed: boolean
}

/**
 * Überträgt eine Datei in Stücken und liefert am Ende ein Ticket, das die
 * fachliche Route einlöst.
 *
 * Jeder Request bleibt klein, dadurch steht kein Proxy-Größenlimit mehr im Weg.
 * Ein abgebrochener Upload lässt sich fortsetzen, weil der Server anhand des
 * Dateifingerabdrucks die angefangene Sitzung wiederfindet.
 */
export async function uploadInChunks(
  file: File,
  kind: UploadKind,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadTicket> {
  const { onProgress, signal } = options

  const session = (await readJson(
    await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify({
        kind,
        originalName: file.name,
        mimeType: file.type,
        totalBytes: file.size,
        fingerprint: await fingerprintFor(file),
      }),
    }),
  )) as SessionResponse

  const { sessionId, chunkSize, chunkCount, received, resumed } = session

  const sizeOf = (index: number) =>
    index === chunkCount - 1 ? file.size - chunkSize * index : chunkSize

  // Was schon liegt, zählt zum Fortschritt — aber nicht in die Rate, sonst
  // wäre sie beim Fortsetzen im ersten Moment absurd hoch.
  const resumedBytes = received.reduce((sum, index) => sum + sizeOf(index), 0)
  let freshBytes = 0
  const startedAt = Date.now()

  const report = () => {
    const sentBytes = resumedBytes + freshBytes
    const seconds = (Date.now() - startedAt) / 1000
    const rate = seconds > 0 && freshBytes > 0 ? freshBytes / seconds : 0
    onProgress?.({
      sentBytes,
      totalBytes: file.size,
      percent: file.size > 0 ? Math.round((sentBytes / file.size) * 100) : 0,
      bytesPerSecond: rate,
      secondsRemaining: rate > 0 ? Math.round((file.size - sentBytes) / rate) : null,
      resumed,
    })
  }
  report()

  const done = new Set(received)
  const queue = Array.from({ length: chunkCount }, (_, index) => index).filter((index) => !done.has(index))

  const sendOne = async (index: number) => {
    const start = index * chunkSize
    const blob = file.slice(start, start + sizeOf(index))
    const buffer = await blob.arrayBuffer()
    const digest = await sha256Hex(buffer)

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`/api/uploads/${sessionId}/chunks/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'x-chunk-sha256': digest },
          credentials: 'include',
          signal,
          body: buffer,
        })
        await readJson(response)
        freshBytes += blob.size
        report()
        return
      } catch (cause) {
        if (signal?.aborted) throw cause
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(
            `Teil ${index + 1} von ${chunkCount} ließ sich nicht übertragen: ${(cause as Error).message}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
      }
    }
  }

  // Feste Zahl an Arbeitern, die sich aus derselben Liste bedienen — so laufen
  // nie mehr Verbindungen gleichzeitig als vorgesehen.
  await Promise.all(
    Array.from({ length: Math.min(concurrency(), queue.length) }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        await sendOne(index)
      }
    }),
  )

  const completed = (await readJson(
    await fetch(`/api/uploads/${sessionId}/complete`, {
      method: 'POST',
      credentials: 'include',
      signal,
    }),
  )) as { sha256: string; sizeBytes: number }

  return { uploadId: sessionId, sha256: completed.sha256, sizeBytes: completed.sizeBytes }
}

/** Bricht eine Sitzung ab. Fehler sind hier ohne Belang — der Aufräum-Job holt den Rest. */
export async function cancelUpload(sessionId: string) {
  await fetch(`/api/uploads/${sessionId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
}

/** Für die Anzeige im Dialog: „12,4 MB/s“ und „noch 2:05“. */
export function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond <= 0) return null
  const mb = bytesPerSecond / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
}

export function formatRemaining(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return `noch ${Math.max(1, Math.round(seconds))} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `noch ${minutes}:${String(rest).padStart(2, '0')} min`
}
