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

/**
 * Ob dieser eingeloggte Discord-Account diese Unterschrift leisten darf.
 *
 * Drei Fälle:
 *
 * - Die Zeile trägt eine Discord-ID (interne Partei oder Arbeitsvertrag):
 *   nur dieser Account kommt durch.
 * - Es gibt einen Agent dahinter: dessen aktuelle Discord-ID gilt zusätzlich.
 *   HR kann sie nachträglich korrigieren; ohne diesen Fallback bliebe sonst
 *   auch der richtige Account dauerhaft ausgesperrt.
 * - Weder noch — eine externe Behörde: dann ist der **Besitz des Links** der
 *   Nachweis. Das ist eine bewusste Abwägung; eine fremde Behörde hat keinen
 *   Account in diesem Dashboard. Wo der Link kopiert wird, muss das stehen.
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
