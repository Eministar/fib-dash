/**
 * Kummerkasten: reine Logik ohne Datenbank (testbar). Einsendungen kommen vom
 * PD-Bot über `POST /api/kummerkasten`.
 *
 * Anonymität: Bei `anonymous=true` werden alle Absenderfelder verworfen, selbst
 * wenn der Client sie mitschickt. Nichts davon landet in Datenbank, Forum oder Log.
 */

export const KUMMERKASTEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const
export type KummerkastenStatusValue = (typeof KUMMERKASTEN_STATUSES)[number]

export const KUMMERKASTEN_STATUS_LABELS: Record<KummerkastenStatusValue, string> = {
  OPEN: 'Offen',
  IN_PROGRESS: 'In Bearbeitung',
  DONE: 'Erledigt',
}

/** Badge-Variante je Status (Dashboard). */
export const KUMMERKASTEN_STATUS_VARIANT: Record<KummerkastenStatusValue, 'warning' | 'info' | 'success'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'info',
  DONE: 'success',
}

export const MAX_SUBJECT_LENGTH = 120
export const MAX_MESSAGE_LENGTH = 4000
/** Der Bot komprimiert vorher; mehr als das kommt nur von fremden Clients. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function kummerkastenNumber(id: number) {
  return `KK-${String(id).padStart(4, '0')}`
}

export function isKummerkastenStatus(value: unknown): value is KummerkastenStatusValue {
  return typeof value === 'string' && (KUMMERKASTEN_STATUSES as readonly string[]).includes(value)
}

export type KummerkastenInput = {
  subject: string
  message: string
  anonymous: boolean
  authorName: string | null
  authorDiscordId: string | null
  authorAvatarUrl: string | null
}

function text(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
}

function parseBoolean(value: unknown) {
  const raw = text(value).toLowerCase()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return null
}

function avatarUrl(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) && raw.length <= 512 ? raw : null
  } catch {
    return null
  }
}

/** Prüft die Formularfelder einer Einsendung. Wirft mit deutscher Meldung bei ungültigen Daten. */
export function parseKummerkastenInput(fields: Record<string, unknown>): KummerkastenInput {
  const subject = text(fields.subject).replace(/\s+/g, ' ')
  const message = text(fields.message)
  const anonymous = parseBoolean(fields.anonymous)

  if (anonymous === null) throw new Error('Feld „anonymous“ muss true oder false sein')
  if (!subject) throw new Error('Betreff fehlt')
  if (subject.length > MAX_SUBJECT_LENGTH) throw new Error(`Betreff ist zu lang (max. ${MAX_SUBJECT_LENGTH} Zeichen)`)
  if (!message) throw new Error('Nachricht fehlt')
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error(`Nachricht ist zu lang (max. ${MAX_MESSAGE_LENGTH} Zeichen)`)

  if (anonymous) {
    return { subject, message, anonymous: true, authorName: null, authorDiscordId: null, authorAvatarUrl: null }
  }

  const authorName = text(fields.authorName).replace(/\s+/g, ' ')
  const authorDiscordId = text(fields.authorDiscordId)
  if (!authorName) throw new Error('Name fehlt (nicht anonyme Einsendung)')
  if (authorName.length > 120) throw new Error('Name ist zu lang')
  if (!/^\d{17,22}$/.test(authorDiscordId)) throw new Error('Ungültige Discord-ID')

  return { subject, message, anonymous: false, authorName, authorDiscordId, authorAvatarUrl: avatarUrl(fields.authorAvatarUrl) }
}

/** Erkennt JPEG/PNG anhand der Signatur. Andere Formate nimmt der Kummerkasten nicht an. */
export function detectKummerkastenImage(bytes: Uint8Array) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', mimeType: 'image/jpeg' } as const
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length > 8 && png.every((byte, index) => bytes[index] === byte)) return { extension: 'png', mimeType: 'image/png' } as const
  return null
}
