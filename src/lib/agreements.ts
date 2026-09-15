// Bewusst ohne Node-Imports: Client-Komponenten nutzen Status-Labels und Schemas.
import { z } from 'zod'
import { sanitizeContractClauses, type ContractClause } from './contracts'

export const AGREEMENT_STATUSES = ['DRAFT', 'OPEN', 'SIGNED', 'DECLINED', 'CANCELLED'] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const AGREEMENT_STATUS_META: Record<AgreementStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { label: 'Entwurf', variant: 'default' },
  OPEN: { label: 'Offen', variant: 'warning' },
  SIGNED: { label: 'Unterschrieben', variant: 'success' },
  DECLINED: { label: 'Abgelehnt', variant: 'danger' },
  CANCELLED: { label: 'Zurückgezogen', variant: 'default' },
}

export const AGREEMENT_LETTERHEADS = ['FIB', 'NEUTRAL'] as const
export type AgreementLetterhead = (typeof AGREEMENT_LETTERHEADS)[number]

export function isAgreementStatus(value: unknown): value is AgreementStatus {
  return typeof value === 'string' && (AGREEMENT_STATUSES as readonly string[]).includes(value)
}

type PartyState = { signedAt: Date | string | null; declinedAt: Date | string | null }

/** Nur ein offener Vertrag ändert seinen Status durch Unterschriften. */
export function deriveAgreementStatus(current: AgreementStatus, parties: PartyState[]): AgreementStatus {
  if (current !== 'OPEN') return current
  if (parties.some((party) => party.declinedAt)) return 'DECLINED'
  if (parties.length > 0 && parties.every((party) => party.signedAt)) return 'SIGNED'
  return 'OPEN'
}

export function normalizeClauses(value: unknown): ContractClause[] {
  return sanitizeContractClauses(value)
}

const partySchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, 'Jede Partei braucht einen Namen').max(200),
  role: z.string().trim().max(200).nullish(),
})

export const agreementInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel ist erforderlich').max(200),
    letterhead: z.enum(AGREEMENT_LETTERHEADS).default('FIB'),
    content: z.string().max(20000).default(''),
    clauses: z.array(z.unknown()).max(60).default([]),
    closing: z.string().max(20000).nullish(),
    templateId: z.string().max(64).nullish(),
    parties: z.array(partySchema).min(1, 'Mindestens eine Partei angeben').max(20),
  })
  .strict()
export type AgreementInput = z.infer<typeof agreementInputSchema>

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name ist erforderlich').max(120),
    letterhead: z.enum(AGREEMENT_LETTERHEADS).default('FIB'),
    content: z.string().max(20000).default(''),
    clauses: z.array(z.unknown()).max(60).default([]),
    closing: z.string().max(20000).nullish(),
  })
  .strict()
export type TemplateInput = z.infer<typeof templateInputSchema>

export const linkActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('sign'),
    name: z.string().trim().min(3, 'Bitte den vollständigen Namen eintragen').max(200),
    confirmed: z.literal(true, { error: 'Bitte bestätigen, dass du den Vertrag gelesen hast' }),
  }),
  z.object({
    action: z.literal('decline'),
    reason: z.string().trim().max(1000).optional(),
  }),
])
export type LinkAction = z.infer<typeof linkActionSchema>
