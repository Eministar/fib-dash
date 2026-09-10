import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma } from './prisma'

/**
 * Schlüssel der Datei-Upload-API. Bewusst getrennt von `api-tokens.ts`:
 * ein Upload-Schlüssel gehört keinem Nutzer und trägt keine Permissions —
 * er darf genau eines, nämlich Dateien hochladen.
 */

export const UPLOAD_KEY_PREFIX = 'fibup_'
const UPLOAD_KEY_BYTES = 32
const UPLOAD_KEY_PEEK_LENGTH = 14
const USAGE_WRITE_THROTTLE_MS = 60_000

export class UploadKeyError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message)
    this.name = 'UploadKeyError'
  }
}

function base62(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let n = BigInt('0x' + bytes.toString('hex'))
  let out = ''
  while (n > BigInt(0)) {
    out = alphabet[Number(n % BigInt(62))] + out
    n = n / BigInt(62)
  }
  return out
}

export function hashUploadKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** Anzeigeform: genug zum Wiedererkennen, zu wenig zum Benutzen. */
export function uploadKeyPrefix(plaintext: string): string {
  return `${plaintext.slice(0, UPLOAD_KEY_PEEK_LENGTH)}…`
}

export function generateUploadKey(): { plaintext: string; keyHash: string; prefix: string } {
  const plaintext = `${UPLOAD_KEY_PREFIX}${base62(randomBytes(UPLOAD_KEY_BYTES))}`
  return { plaintext, keyHash: hashUploadKey(plaintext), prefix: uploadKeyPrefix(plaintext) }
}

/**
 * Liest den Schlüssel aus dem Request. Primär `X-Upload-Key`, zusätzlich
 * `Authorization: Bearer fibup_…`, weil manche HTTP-Clients keine freien
 * Header setzen können.
 */
export function extractUploadKey(headers: Headers): string | null {
  const direct = headers.get('x-upload-key')?.trim()
  if (direct) return direct
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization')?.trim() ?? '')
  const value = bearer?.[1]
  return value?.startsWith(UPLOAD_KEY_PREFIX) ? value : null
}

/**
 * Prüft einen Klartext-Schlüssel und liefert den Datensatz.
 *
 * Der Vergleich läuft über den Hash (Lookup per unique index) und zusätzlich
 * `timingSafeEqual`, damit die Antwortzeit nichts über den Treffer verrät.
 * Wirft `UploadKeyError` statt `null` zurückzugeben, damit der Aufrufer die
 * Ursache (fehlt / unbekannt / widerrufen / abgelaufen) weitergeben kann.
 */
export async function authenticateUploadKey(headers: Headers) {
  const plaintext = extractUploadKey(headers)
  if (!plaintext) throw new UploadKeyError('Kein Upload-Schlüssel übermittelt. Header: X-Upload-Key', 401)
  if (!plaintext.startsWith(UPLOAD_KEY_PREFIX)) throw new UploadKeyError('Ungültiger Upload-Schlüssel', 401)

  const keyHash = hashUploadKey(plaintext)
  const key = await prisma.uploadKey.findUnique({ where: { keyHash } })
  if (!key) throw new UploadKeyError('Ungültiger Upload-Schlüssel', 401)

  const expected = Buffer.from(key.keyHash, 'hex')
  const actual = Buffer.from(keyHash, 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new UploadKeyError('Ungültiger Upload-Schlüssel', 401)
  }
  if (key.revokedAt) throw new UploadKeyError('Dieser Upload-Schlüssel wurde widerrufen', 403)
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    throw new UploadKeyError('Dieser Upload-Schlüssel ist abgelaufen', 403)
  }
  return key
}

/**
 * Zählt die Nutzung mit. Der Zeitstempel wird gedrosselt geschrieben, damit
 * ein Massenimport nicht für jede Datei dieselbe Zeile aktualisiert.
 */
export async function recordUploadKeyUsage(keyId: string, lastUsedAt: Date | null) {
  const stale = !lastUsedAt || Date.now() - lastUsedAt.getTime() > USAGE_WRITE_THROTTLE_MS
  await prisma.uploadKey
    .update({
      where: { id: keyId },
      data: { usageCount: { increment: 1 }, ...(stale ? { lastUsedAt: new Date() } : {}) },
    })
    .catch(() => undefined)
}
