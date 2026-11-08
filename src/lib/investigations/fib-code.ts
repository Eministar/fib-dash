/**
 * FIB-Einsatzcode (Dekodierung + Validierung).
 *
 * Gegenstück zu `nerov_mdt/server/fibcode.js` im FiveM-Script – das Format muss
 * auf beiden Seiten identisch bleiben. Aufbau der Bytes vor der Umwandlung in
 * eine einzige Dezimalzahl:
 *
 *   [0x01 Sentinel] [Version] [Flags] [Body …] [HMAC-SHA256, 16 Byte]
 *
 * Der Sentinel erhält die Byte-Länge exakt (fehlende führende Nullen), Flags
 * Bit 0 markiert einen Raw-Deflate-Body. Der HMAC deckt Version, Flags und
 * Body ab. Der Code ist signiert, NICHT verschlüsselt: der Inhalt ist für
 * jeden lesbar, der ihn besitzt – die Signatur belegt nur die Herkunft.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

export const FIB_CODE_VERSION = 1
const FLAG_DEFLATE = 1
const TAG_LEN = 16
export const FIB_CODE_MAX_JSON_BYTES = 96 * 1024
export const FIB_CODE_MAX_DIGITS = 120000

export type FibCodeErrorReason = 'format' | 'too_large' | 'corrupt' | 'version' | 'signature' | 'schema' | 'no_secret'

export class FibCodeError extends Error {
  constructor(public readonly reason: FibCodeErrorReason, message: string) {
    super(message)
    this.name = 'FibCodeError'
  }
}

function sign(secret: string, data: Buffer) {
  return createHmac('sha256', secret).update(data).digest().subarray(0, TAG_LEN)
}

function requireSecret(secret: string | undefined): string {
  if (!secret || secret.length < 16) {
    throw new FibCodeError('no_secret', 'Der Signatur-Schlüssel für FIB-Einsatzcodes ist nicht konfiguriert (FIB_CODE_SECRET).')
  }
  return secret
}

/** Wandelt einen JSON-Text in einen Zahlencode um. Im Dashboard nur für Tests nötig. */
export function encodeFibCode(json: string, secret: string): string {
  requireSecret(secret)
  const raw = Buffer.from(json, 'utf8')
  if (raw.length > FIB_CODE_MAX_JSON_BYTES) throw new FibCodeError('too_large', 'Einsatzdaten sind zu groß.')
  const deflated = deflateRawSync(raw, { level: 9 })
  const useDeflate = deflated.length < raw.length
  const body = useDeflate ? deflated : raw
  const head = Buffer.from([FIB_CODE_VERSION, useDeflate ? FLAG_DEFLATE : 0])
  const tag = sign(secret, Buffer.concat([head, body]))
  return BigInt('0x01' + Buffer.concat([head, body, tag]).toString('hex')).toString(10)
}

/** Prüft Format, Signatur und Version und liefert den ursprünglichen JSON-Text. */
export function decodeFibCode(code: string, secret: string | undefined): string {
  const key = requireSecret(secret)
  const digits = String(code ?? '').replace(/\s+/g, '')
  if (!digits) throw new FibCodeError('format', 'Bitte einen Einsatzcode eingeben.')
  if (!/^[0-9]+$/.test(digits)) throw new FibCodeError('format', 'Der Code darf nur Ziffern (0–9) enthalten.')
  if (digits.length > FIB_CODE_MAX_DIGITS) throw new FibCodeError('too_large', 'Der Code ist zu lang.')

  let hex = BigInt(digits).toString(16)
  if (hex.length % 2) hex = '0' + hex
  const all = Buffer.from(hex, 'hex')
  if (all.length < 3 + TAG_LEN || all[0] !== 1) throw new FibCodeError('corrupt', 'Der Code ist unvollständig oder beschädigt.')
  const bytes = all.subarray(1)
  if (bytes[0] !== FIB_CODE_VERSION) throw new FibCodeError('version', 'Unbekannte Code-Version – bitte Script und Dashboard aktualisieren.')

  const head = bytes.subarray(0, 2)
  const body = bytes.subarray(2, bytes.length - TAG_LEN)
  const tag = bytes.subarray(bytes.length - TAG_LEN)
  const expected = sign(key, Buffer.concat([head, body]))
  if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) {
    throw new FibCodeError('signature', 'Signatur ungültig: Der Code ist beschädigt, unvollständig oder stammt nicht vom FIB-Server.')
  }

  let raw: Buffer = body
  if (head[1] & FLAG_DEFLATE) {
    try {
      raw = inflateRawSync(body, { maxOutputLength: FIB_CODE_MAX_JSON_BYTES })
    } catch {
      throw new FibCodeError('corrupt', 'Der Code konnte nicht entpackt werden.')
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw new FibCodeError('corrupt', 'Der Code enthält ungültigen Text.')
  }
}

// ── Nutzdaten ──────────────────────────────────────────────────────────────

export interface FibOffense { name: string; paragraph: string; fine: number; jail: number }
export interface FibPerson { first: string; last: string; role: 'criminal' | 'civilian'; offenses: FibOffense[] }
export interface FibOfficer { first: string; last: string }
export interface FibVehicle { plate: string; model: string; owner: string }
export interface FibItem { name: string; amount: number }

export interface FibPayload {
  v: 1
  /** Zufällige Export-ID (32 Hex-Zeichen). */
  id: string
  /** Erzeugungszeitpunkt (Unix-Sekunden). */
  iat: number
  src: { server: string; caseId: number }
  issuer: { name: string; badge: string }
  case: {
    title: string
    authority: string
    status: string
    /** ISO `YYYY-MM-DD` oder leer. */
    date: string
    /** `HH:MM` oder leer. */
    time: string
    plz: string
    affiliation: string
    report: string
  }
  persons: FibPerson[]
  officers: FibOfficer[]
  vehicles: FibVehicle[]
  items: FibItem[]
}

export const FIB_LIMITS = {
  report: 20000,
  persons: 50,
  officers: 50,
  vehicles: 50,
  items: 100,
  offenses: 60,
} as const

type Obj = Record<string, unknown>

function fail(message: string): never {
  throw new FibCodeError('schema', `Ungültige Einsatzdaten: ${message}`)
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Entfernt Steuerzeichen (außer Zeilenumbruch/Tab), vereinheitlicht Zeilenenden. */
export function cleanFibText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .trim()
}

function str(source: Obj, key: string, max: number, label = key): string {
  const value = source[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') fail(`${label} ist kein Text`)
  const cleaned = cleanFibText(value)
  if (cleaned.length > max) fail(`${label} ist zu lang`)
  return cleaned
}

function num(source: Obj, key: string, min: number, max: number, label = key): number {
  const value = source[key]
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} ist keine gültige Zahl`)
  return Math.trunc(value)
}

function list(source: Obj, key: string, max: number): Obj[] {
  const value = source[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail(`${key} ist keine Liste`)
  if (value.length > max) fail(`${key} enthält zu viele Einträge`)
  return value.map((entry) => (isObj(entry) ? entry : fail(`${key} enthält einen ungültigen Eintrag`)))
}

/** Prüft die dekodierten Daten streng und liefert eine bereinigte Kopie. */
export function parseFibPayload(json: string): FibPayload {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new FibCodeError('corrupt', 'Die Einsatzdaten sind kein gültiges JSON.')
  }
  if (!isObj(raw)) fail('Wurzel ist kein Objekt')
  if (raw.v !== 1) throw new FibCodeError('version', 'Unbekanntes Datenformat – bitte Script und Dashboard aktualisieren.')

  const id = str(raw, 'id', 64)
  if (!/^[0-9a-f]{32}$/.test(id)) fail('Export-ID fehlt')
  const iat = num(raw, 'iat', 1, 4_102_444_800)
  if (!iat) fail('Zeitstempel fehlt')

  const src = isObj(raw.src) ? raw.src : fail('Quelle fehlt')
  const server = str(src, 'server', 40)
  const caseId = num(src, 'caseId', 1, 2_147_483_647)
  if (!server || !caseId) fail('Quelle unvollständig')

  const issuer = isObj(raw.issuer) ? raw.issuer : {}
  const c = isObj(raw.case) ? raw.case : fail('Akte fehlt')

  const date = str(c, 'date', 10)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Datum ist ungültig')
  const time = str(c, 'time', 5)
  if (time && !/^\d{2}:\d{2}$/.test(time)) fail('Uhrzeit ist ungültig')

  return {
    v: 1,
    id,
    iat,
    src: { server, caseId },
    issuer: { name: str(issuer, 'name', 120), badge: str(issuer, 'badge', 40) },
    case: {
      title: str(c, 'title', 200),
      authority: str(c, 'authority', 20),
      status: str(c, 'status', 50),
      date,
      time,
      plz: str(c, 'plz', 5),
      affiliation: str(c, 'affiliation', 120),
      report: str(c, 'report', FIB_LIMITS.report),
    },
    persons: list(raw, 'persons', FIB_LIMITS.persons).map((p) => {
      const role = p.role === 'criminal' || p.role === 'civilian' ? p.role : fail('Personenrolle unbekannt')
      return {
        first: str(p, 'first', 100),
        last: str(p, 'last', 100),
        role,
        offenses: list(p, 'offenses', FIB_LIMITS.offenses).map((o) => ({
          name: str(o, 'name', 200),
          paragraph: str(o, 'paragraph', 40),
          fine: num(o, 'fine', 0, 2_000_000_000),
          jail: num(o, 'jail', 0, 100_000),
        })),
      }
    }),
    officers: list(raw, 'officers', FIB_LIMITS.officers).map((o) => ({ first: str(o, 'first', 100), last: str(o, 'last', 100) })),
    vehicles: list(raw, 'vehicles', FIB_LIMITS.vehicles).map((v) => ({
      plate: str(v, 'plate', 32),
      model: str(v, 'model', 120),
      owner: str(v, 'owner', 200),
    })),
    items: list(raw, 'items', FIB_LIMITS.items).map((i) => ({ name: str(i, 'name', 120), amount: num(i, 'amount', 0, 1_000_000) })),
  }
}

/** Komplette Pipeline: Code → geprüfte Nutzdaten. */
export function readFibCode(code: string, secret: string | undefined): FibPayload {
  return parseFibPayload(decodeFibCode(code, secret))
}
