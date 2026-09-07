// Client-sicher: keine Node-/Prisma-Imports. Feld- und Klausel-Logik wird
// bewusst aus `contracts.ts` wiederverwendet — ein Versetzungsantrag ist
// dasselbe Dokumentformat wie ein Arbeitsvertrag, nur mit drei Unterschriften.

import type { ContractClause, ContractField } from '@/lib/contracts'

export const TRANSFER_REQUEST_PREFIX = 'VA-'

export const TRANSFER_REQUEST_STATUSES = [
  'DRAFT',
  'SENT',
  'IN_SIGNING',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
] as const

export type TransferRequestStatusValue = (typeof TRANSFER_REQUEST_STATUSES)[number]

export const TRANSFER_REQUEST_STATUS_META: Record<
  TransferRequestStatusValue,
  { label: string; shortLabel: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }
> = {
  DRAFT: { label: 'Entwurf', shortLabel: 'Entwurf', variant: 'default' },
  SENT: { label: 'Versendet – wartet auf Unterschriften', shortLabel: 'Offen', variant: 'warning' },
  IN_SIGNING: { label: 'Teilweise unterschrieben', shortLabel: 'In Unterschrift', variant: 'warning' },
  COMPLETED: { label: 'Vollständig unterschrieben', shortLabel: 'Fertig', variant: 'success' },
  DECLINED: { label: 'Abgelehnt', shortLabel: 'Abgelehnt', variant: 'danger' },
  CANCELLED: { label: 'Zurückgezogen', shortLabel: 'Zurückgezogen', variant: 'default' },
}

export function isTransferRequestStatus(value: unknown): value is TransferRequestStatusValue {
  return typeof value === 'string' && (TRANSFER_REQUEST_STATUSES as readonly string[]).includes(value)
}

/** Die drei Unterschriftsfelder des Antrags. */
export const SIGNATURE_ROLES = ['HR', 'AGENT', 'AUTHORITY'] as const
export type SignatureRole = (typeof SIGNATURE_ROLES)[number]

export const SIGNATURE_ROLE_META: Record<
  SignatureRole,
  { title: string; caption: string; who: string }
> = {
  HR: {
    title: 'Unterschrift FIB',
    caption: 'Für das Federal Investigation Bureau',
    who: 'Nur Mitarbeiter der Personalabteilung (HR-Verwaltungsrecht).',
  },
  AGENT: {
    title: 'Unterschrift des Beamten',
    caption: 'Antragsteller',
    who: 'Nur der Beamte selbst — angemeldet mit seinem Discord-Account.',
  },
  AUTHORITY: {
    title: 'Unterschrift entgegennehmende Behörde',
    caption: 'Aufnehmende Behörde',
    who: 'Jeder mit diesem Link, auch ohne Anmeldung.',
  },
}

export function isSignatureRole(value: unknown): value is SignatureRole {
  return typeof value === 'string' && (SIGNATURE_ROLES as readonly string[]).includes(value)
}

export interface TransferSignatureState {
  role: SignatureRole
  name: string | null
  signedAt: string | null
  roleLabel?: string | null
}

/** Fertig ist der Antrag erst, wenn alle drei Unterschriften stehen. */
export function isFullySigned(signatures: TransferSignatureState[]) {
  return SIGNATURE_ROLES.every((role) => (
    signatures.some((signature) => signature.role === role && Boolean(signature.signedAt))
  ))
}

export const DEFAULT_TRANSFER_TITLE = 'Antrag auf Versetzung'

export const DEFAULT_TRANSFER_CONTENT = `Hiermit beantragt

**{{name}}**, Dienstnummer **{{dienstnummer}}**, Dienstgrad **{{rang}}**,
tätig beim **{{department}}**,

die Versetzung zur nachfolgend bezeichneten Behörde. Der Antrag wird der
Personalabteilung des Departments sowie der entgegennehmenden Behörde zur
Prüfung und Zeichnung vorgelegt.`

export const DEFAULT_TRANSFER_CLOSING = `Der Antrag wird erst mit allen drei Unterschriften wirksam. Bis zur vollständigen
Zeichnung bleibt der Antragsteller uneingeschränkt seiner bisherigen Dienststelle
zugeordnet und unterliegt deren Weisungen.`

export const DEFAULT_TRANSFER_CLAUSES: ContractClause[] = [
  {
    id: 'gegenstand',
    title: 'Gegenstand des Antrags',
    body: 'Der Antragsteller beantragt die Versetzung aus seiner derzeitigen Verwendung beim {{department}} zur entgegennehmenden Behörde. Die Versetzung erfolgt erst nach Zustimmung beider Behörden.',
    sortOrder: 0,
  },
  {
    id: 'dienstliche_pflichten',
    title: 'Fortbestehende Pflichten',
    body: 'Bis zum Wirksamwerden der Versetzung bestehen alle dienstlichen Pflichten fort. Die Verschwiegenheitspflicht über dienstliche Angelegenheiten gilt auch nach der Versetzung unbefristet weiter.',
    sortOrder: 1,
  },
  {
    id: 'ausruestung',
    title: 'Ausrüstung und Dienstausweis',
    body: 'Sämtliche vom Department überlassene Ausrüstung einschließlich Dienstwaffe und Dienstausweis ist bis zum Tag des Wechsels vollständig zurückzugeben.',
    sortOrder: 2,
  },
  {
    id: 'ruecknahme',
    title: 'Rücknahme des Antrags',
    body: 'Der Antrag kann bis zur letzten Unterschrift ohne Angabe von Gründen zurückgenommen werden. Nach vollständiger Zeichnung ist eine Rücknahme nur im Einvernehmen beider Behörden möglich.',
    sortOrder: 3,
  },
]

export const DEFAULT_TRANSFER_FIELDS: ContractField[] = [
  {
    id: 'aktuelle_dienststelle',
    type: 'SHORT_TEXT',
    label: 'Aktuelle Dienststelle / Unit',
    description: null,
    placeholder: 'z. B. Patrol Division',
    required: true,
    sortOrder: 0,
  },
  {
    id: 'ziel_behoerde',
    type: 'SHORT_TEXT',
    label: 'Entgegennehmende Behörde',
    description: 'Wohin soll die Versetzung erfolgen?',
    placeholder: 'z. B. Los Santos Sheriff Department',
    required: true,
    sortOrder: 1,
  },
  {
    id: 'wunschtermin',
    type: 'DATE',
    label: 'Gewünschter Versetzungstermin',
    description: null,
    placeholder: null,
    required: true,
    sortOrder: 2,
  },
  {
    id: 'begruendung',
    type: 'LONG_TEXT',
    label: 'Begründung des Antrags',
    description: 'Warum wird die Versetzung beantragt?',
    placeholder: null,
    required: true,
    sortOrder: 3,
  },
  {
    id: 'anmerkungen',
    type: 'LONG_TEXT',
    label: 'Anmerkungen',
    description: 'Optionale Ergänzungen.',
    placeholder: null,
    required: false,
    sortOrder: 4,
  },
  {
    id: 'richtigkeit_bestaetigt',
    type: 'CHECKBOX',
    label: 'Ich bestätige die Richtigkeit und Vollständigkeit meiner Angaben.',
    description: null,
    placeholder: null,
    required: true,
    sortOrder: 5,
  },
]
