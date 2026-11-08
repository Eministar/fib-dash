/**
 * Zuordnung eines FIB-Einsatzcodes zu den Feldern einer Einsatzakte.
 *
 * Client- und serverseitig nutzbar (keine Node-/Prisma-Importe). Der Server
 * baut daraus den Entwurf für die Vorschau; vor dem Speichern wird der vom
 * Client bearbeitete Entwurf mit `parseImportDraft` erneut streng geprüft –
 * dem Client wird nie vertraut.
 *
 * Es werden keine Angaben erfunden: Was der Code nicht enthält, bleibt leer.
 */
import type { FibPayload } from '@/lib/investigations/fib-code'
import { cleanFibText } from '@/lib/investigations/fib-code'

export const IMPORT_ROLES = ['SUSPECT', 'WITNESS', 'VICTIM', 'INFORMANT', 'ACCOMPLICE', 'OTHER'] as const
export type ImportRole = (typeof IMPORT_ROLES)[number]
export const IMPORT_STATUSES = ['OPEN', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'] as const
export const IMPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const

export interface ImportPersonDraft {
  firstName: string
  lastName: string
  role: ImportRole
  /** Notiz zur Person in genau dieser Akte (z. B. vorgeworfene Delikte). */
  note: string
}
export interface ImportVehicleDraft {
  plate: string
  model: string
  /** Halter laut MDT (Text; wird in der Fahrzeugnotiz vermerkt). */
  owner: string
}
export interface ImportItemDraft {
  title: string
  quantity: number | null
}

export interface ImportDraft {
  title: string
  summary: string
  status: (typeof IMPORT_STATUSES)[number]
  priority: (typeof IMPORT_PRIORITIES)[number]
  /** `YYYY-MM-DD` oder leer. */
  occurredDate: string
  /** `HH:MM` oder leer. */
  occurredTime: string
  location: string
  report: string
  persons: ImportPersonDraft[]
  vehicles: ImportVehicleDraft[]
  items: ImportItemDraft[]
}

export function importSourceKey(payload: FibPayload) {
  return `${payload.src.server}:${payload.src.caseId}`
}

const STATUS_BY_MDT: Record<string, ImportDraft['status']> = {
  offen: 'OPEN',
  geschlossen: 'CLOSED',
  archiviert: 'ARCHIVED',
}

function fullName(first: string, last: string) {
  return [first, last].filter(Boolean).join(' ')
}

function money(value: number) {
  return `${value.toLocaleString('de-DE')} $`
}

function offenseLines(offenses: FibPayload['persons'][number]['offenses']) {
  return offenses.map((o) => {
    const parts = [o.fine ? money(o.fine) : '', o.jail ? `${o.jail} Mo. Haft` : ''].filter(Boolean)
    return `- ${o.paragraph ? `§${o.paragraph} ` : ''}${o.name}${parts.length ? ` (${parts.join(', ')})` : ''}`
  })
}

/** Baut den Vorschau-Entwurf aus den geprüften Nutzdaten. */
export function buildImportDraft(payload: FibPayload): ImportDraft {
  const c = payload.case
  const facts = [
    c.authority && `- **Behörde:** ${c.authority}`,
    c.plz && `- **Tatort (PLZ):** ${c.plz}`,
    c.affiliation && `- **Zugehörigkeit:** ${c.affiliation}`,
    `- **Quelle:** MDT-Akte #${payload.src.caseId}`,
    payload.issuer.name && `- **Erfasst von:** ${payload.issuer.name}${payload.issuer.badge ? ` (${payload.issuer.badge})` : ''}`,
  ].filter(Boolean) as string[]

  const sections = [`## Eckdaten\n${facts.join('\n')}`]

  const officers = payload.officers.map((o) => fullName(o.first, o.last)).filter(Boolean)
  if (officers.length) sections.push(`## Beteiligte Beamte\n${officers.map((name) => `- ${name}`).join('\n')}`)

  return {
    title: c.title,
    summary: sections.join('\n\n'),
    status: STATUS_BY_MDT[c.status.toLowerCase()] ?? 'OPEN',
    priority: 'NORMAL',
    occurredDate: c.date,
    occurredTime: c.time,
    location: c.plz ? `PLZ ${c.plz}` : '',
    report: c.report,
    persons: payload.persons.map((p) => ({
      firstName: p.first,
      lastName: p.last,
      // Der MDT unterscheidet nur Kriminelle/Zivilisten. Zivilisten werden nicht
      // als Zeugen oder Geschädigte geraten – die Rolle wählt der Agent.
      role: p.role === 'criminal' ? 'SUSPECT' : 'OTHER',
      note: offenseLines(p.offenses).join('\n'),
    })),
    vehicles: payload.vehicles.map((v) => ({ plate: v.plate, model: v.model, owner: v.owner })),
    items: payload.items.map((i) => ({ title: i.name, quantity: i.amount > 0 ? i.amount : null })),
  }
}

// ── Strenge Prüfung des bearbeiteten Entwurfs (Server) ─────────────────────

export const IMPORT_LIMITS = {
  title: 200,
  summary: 20000,
  report: 20000,
  location: 200,
  persons: 50,
  vehicles: 50,
  items: 100,
  name: 100,
  note: 4000,
  plate: 32,
  model: 120,
  owner: 200,
  itemTitle: 200,
} as const

export class ImportDraftError extends Error {}

type Obj = Record<string, unknown>

function obj(value: unknown, label: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ImportDraftError(`${label} ist ungültig`)
  return value as Obj
}

function text(source: Obj, key: string, max: number, label: string): string {
  const value = source[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ImportDraftError(`${label} ist kein Text`)
  const cleaned = cleanFibText(value)
  if (cleaned.length > max) throw new ImportDraftError(`${label} ist zu lang (max. ${max} Zeichen)`)
  return cleaned
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new ImportDraftError(`${label} ist ungültig`)
  return value as T
}

function items<T>(source: Obj, key: string, max: number, label: string, map: (entry: Obj) => T): T[] {
  const value = source[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ImportDraftError(`${label} ist keine Liste`)
  if (value.length > max) throw new ImportDraftError(`Zu viele ${label} (max. ${max})`)
  return value.map((entry) => map(obj(entry, label)))
}

export function parseImportDraft(input: unknown): ImportDraft {
  const d = obj(input, 'Akte')
  const title = text(d, 'title', IMPORT_LIMITS.title, 'Titel')
  if (!title) throw new ImportDraftError('Titel der Akte ist erforderlich')

  const occurredDate = text(d, 'occurredDate', 10, 'Datum')
  if (occurredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(occurredDate) || Number.isNaN(Date.parse(`${occurredDate}T00:00:00Z`)))) {
    throw new ImportDraftError('Datum ist ungültig')
  }
  const occurredTime = text(d, 'occurredTime', 5, 'Uhrzeit')
  if (occurredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(occurredTime)) throw new ImportDraftError('Uhrzeit ist ungültig')
  if (occurredTime && !occurredDate) throw new ImportDraftError('Uhrzeit ohne Datum ist nicht möglich')

  return {
    title,
    summary: text(d, 'summary', IMPORT_LIMITS.summary, 'Zusammenfassung'),
    status: oneOf(d.status, IMPORT_STATUSES, 'Status'),
    priority: oneOf(d.priority, IMPORT_PRIORITIES, 'Priorität'),
    occurredDate,
    occurredTime,
    location: text(d, 'location', IMPORT_LIMITS.location, 'Ort'),
    report: text(d, 'report', IMPORT_LIMITS.report, 'Einsatzbericht'),
    persons: items(d, 'persons', IMPORT_LIMITS.persons, 'Personen', (p) => {
      const firstName = text(p, 'firstName', IMPORT_LIMITS.name, 'Vorname')
      const lastName = text(p, 'lastName', IMPORT_LIMITS.name, 'Nachname')
      if (!firstName || !lastName) throw new ImportDraftError('Jede Person braucht Vor- und Nachnamen')
      return { firstName, lastName, role: oneOf(p.role, IMPORT_ROLES, 'Rolle'), note: text(p, 'note', IMPORT_LIMITS.note, 'Notiz') }
    }),
    vehicles: items(d, 'vehicles', IMPORT_LIMITS.vehicles, 'Fahrzeuge', (v) => {
      const plate = text(v, 'plate', IMPORT_LIMITS.plate, 'Kennzeichen')
      if (!plate) throw new ImportDraftError('Jedes Fahrzeug braucht ein Kennzeichen')
      return { plate, model: text(v, 'model', IMPORT_LIMITS.model, 'Modell'), owner: text(v, 'owner', IMPORT_LIMITS.owner, 'Halter') }
    }),
    items: items(d, 'items', IMPORT_LIMITS.items, 'Asservate', (i) => {
      const title = text(i, 'title', IMPORT_LIMITS.itemTitle, 'Asservat')
      if (!title) throw new ImportDraftError('Jedes Asservat braucht eine Bezeichnung')
      const q = i.quantity
      if (q !== null && q !== undefined && (typeof q !== 'number' || !Number.isSafeInteger(q) || q < 1 || q > 1_000_000)) {
        throw new ImportDraftError('Menge eines Asservats ist ungültig')
      }
      return { title, quantity: typeof q === 'number' ? q : null }
    }),
  }
}

/** Zeitpunkt aus Datum + Uhrzeit; ohne Datum gibt es keinen (statt eines erfundenen). */
export function draftOccurredAt(draft: Pick<ImportDraft, 'occurredDate' | 'occurredTime'>): Date | null {
  if (!draft.occurredDate) return null
  const date = new Date(`${draft.occurredDate}T${draft.occurredTime || '00:00'}:00`)
  return Number.isNaN(date.getTime()) ? null : date
}
