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

/**
 * Ob diese Partei sich per Discord ausweisen muss.
 *
 * Eine externe Behörde hat keinen Account im Dashboard — dort ist der Besitz
 * des Links der Nachweis. Das ist eine bewusste Abwägung und gehört überall
 * dort benannt, wo der Link kopiert wird: **wer den Link hat, kann
 * unterschreiben.**
 */
export function signatureRequiresDiscord(signature: {
  side: string
  signerDiscordId: string | null
}) {
  return Boolean(signature.signerDiscordId?.trim())
}

/** Kurzform für die Anzeige im Arbeitsbereich. */
export function signatureStateLabel(signature: SignatureState) {
  if (signature.declinedAt) return 'Abgelehnt'
  if (signature.signedAt) return 'Unterschrieben'
  return 'Offen'
}
