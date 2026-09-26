// Bewusst ohne Prisma-Import: die Regeln hier sind rein und werden auch von
// Client-Komponenten gebraucht. Alles Datenbanknahe liegt in
// `contract-signature-service.ts`.

import type { ContractStatusValue } from '@/lib/contracts'

export const CONTRACT_SIDES = ['INTERNAL', 'EXTERNAL'] as const
export type ContractSideValue = (typeof CONTRACT_SIDES)[number]

export const CONTRACT_SIDE_LABELS: Record<ContractSideValue, string> = {
  INTERNAL: 'Eigene Behörde',
  EXTERNAL: 'Gegenpartei',
}

export interface SignatureState {
  signedAt: Date | string | null
  declinedAt: Date | string | null
}

/**
 * Der Vertragsstatus ergibt sich aus den einzelnen Unterschriften, nicht
 * umgekehrt.
 *
 * `CANCELLED` bleibt unangetastet: ein zurückgezogener Vertrag ist eine
 * Entscheidung der Behörde und darf nicht davon abhängen, wer noch zeichnet.
 * Eine Ablehnung wiegt schwerer als eine bereits geleistete Unterschrift der
 * Gegenseite — ein Vertrag, den eine Partei ablehnt, kommt nicht zustande.
 */
export function deriveContractStatus(
  signatures: SignatureState[],
  current: ContractStatusValue,
): ContractStatusValue {
  if (current === 'CANCELLED') return 'CANCELLED'
  if (signatures.length === 0) return current

  if (signatures.some((signature) => signature.declinedAt)) return 'DECLINED'
  if (signatures.every((signature) => signature.signedAt)) return 'SIGNED'

  // Sobald eine Partei gezeichnet hat, ist der Vertrag kein Entwurf mehr —
  // ihn weiter als solchen anzuzeigen, waere irrefuehrend.
  if (signatures.some((signature) => signature.signedAt)) return 'SENT'

  // Sonst bleibt der bisherige Stand, damit ein Entwurf nicht allein durch das
  // Vorhandensein von Zeilen zu "versendet" wird. Ein zuvor abgeschlossener
  // Vertrag, dessen Unterschrift zurueckgenommen wurde, faellt auf "offen".
  return current === 'SIGNED' || current === 'DECLINED' ? 'SENT' : current
}

/** Kurzform für die Anzeige im Arbeitsbereich. */
export function signatureStateLabel(signature: SignatureState) {
  if (signature.declinedAt) return 'Abgelehnt'
  if (signature.signedAt) return 'Unterschrieben'
  return 'Offen'
}

/**
 * Ob dieser eingeloggte Discord-Account die **benannte Partei** dieser Zeile
 * ist.
 *
 * Das ist ausdrücklich keine Zugangsprüfung mehr: wer den Link hat, darf
 * unterschreiben (siehe {@link resolveLinkAccess}). Die Antwort hier
 * entscheidet nur noch, ob jemand *anderes* den Vertrag versehentlich vor sich
 * hat — daran hängt die Leseansicht für HR.
 *
 * Trägt die Zeile keine Identität und steht kein Agent dahinter, gibt es keine
 * benannte Partei; dann trifft die Frage auf jeden zu.
 */
export function signerMatches(
  signature: { side: string; signerDiscordId: string | null },
  agentDiscordId: string | null,
  userDiscordId: string | null,
) {
  const expected = [signature.signerDiscordId?.trim(), agentDiscordId?.trim()].filter(Boolean)
  if (expected.length === 0) return true
  const actual = userDiscordId?.trim()
  return Boolean(actual && expected.includes(actual))
}

/** Wie jemand einen Vertragslink benutzen darf. */
export type ContractLinkAccess = 'signer' | 'auditor'

export interface LinkAccessInput {
  /** Ob der Vertrag überhaupt eine Identität benennt (Zeile oder Agent). */
  hasNamedSigner: boolean
  /** Ob der eingeloggte Account genau diese benannte Partei ist. */
  isNamedSigner: boolean
  /** Ob der eingeloggte Account Verträge im Dashboard sehen darf. */
  canViewContracts: boolean
  /** Ob der eingeloggte Account eine Discord-Prüfrolle trägt. */
  isAuditorRole: boolean
}

/**
 * Entscheidet, wie jemand einen Vertragslink benutzen darf.
 *
 * **Der Link ist der Nachweis.** Wer ihn öffnet, darf ausfüllen und
 * unterschreiben — angemeldet oder nicht. Das ist eine bewusste Abwägung: ein
 * weitergeleiteter Link ist eine gültige Unterschrift, und überall dort, wo der
 * Link kopiert wird, muss das stehen.
 *
 * Die einzige Ausnahme ist die Aufsicht über fremde Verträge: wer eingeloggt
 * ist, Einsicht hat und erkennbar *nicht* die benannte Partei ist, bekommt den
 * Vertrag nur zu lesen. Sonst zeichnete HR beim Nachschauen versehentlich für
 * den Agenten. Benennt der Vertrag niemanden, gibt es auch niemanden, für den
 * man sich vertun könnte — dann gilt wieder der Regelfall.
 */
export function resolveLinkAccess(input: LinkAccessInput): ContractLinkAccess {
  if (!input.hasNamedSigner) return 'signer'
  if (input.isNamedSigner) return 'signer'
  if (input.canViewContracts || input.isAuditorRole) return 'auditor'
  return 'signer'
}
