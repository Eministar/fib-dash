import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/auth'
import { isDiscordContractAuditor } from '@/lib/discord-integration'
import { hasAnyPermission } from '@/lib/permissions'
import { loadSignatureByToken } from '@/lib/contract-signature-service'
import { signatureStateLabel, signerMatches } from '@/lib/contract-signatures'
import { getBadgePrefix } from '@/lib/settings-helpers'
import {
  CONTRACT_PLACE,
  applyContractDatePlaceholders,
  readContractClauses,
  readContractFields,
  readContractValues,
} from '@/lib/contracts'

const contractLinkSelect = {
  id: true,
  token: true,
  title: true,
  content: true,
  clauses: true,
  closing: true,
  fields: true,
  values: true,
  status: true,
  signerDiscordId: true,
  sentAt: true,
  signedAt: true,
  signedName: true,
  declinedAt: true,
  declineReason: true,
  createdAt: true,
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      hireDate: true,
      rank: { select: { name: true } },
    },
  },
}

export type ContractLinkRecord = NonNullable<Awaited<ReturnType<typeof loadContractByToken>>>

/**
 * Sucht den Vertrag zum Link-Token. MySQL vergleicht Strings mit der
 * Standard-Kollation case-insensitiv — deshalb wird zusätzlich exakt
 * nachgeprüft, damit ein Token nicht durch abweichende Groß-/Kleinschreibung
 * auf einen fremden Vertrag zeigen kann.
 */
export async function loadContractByToken(token: string) {
  if (!token) return null

  const contract = await prisma.contract.findUnique({
    where: { token },
    select: contractLinkSelect,
  })
  if (!contract) return null
  if (contract.token !== token) return null

  return contract
}

export interface ContractLinkParty {
  id: string
  side: string
  partyName: string
  partyRole: string | null
  sortOrder: number
  signedAt: Date | null
  signedName: string | null
  declinedAt: Date | null
  declineReason: string | null
  state: string
  /** Nur für die eigene Zeile: die Werte, die diese Partei eingetragen hat. */
  own: boolean
}

/**
 * Löst einen Link-Token gegen seine Unterschriftszeile auf.
 *
 * Nach der Migration trägt jede Zeile den Token ihres Vertrags, verschickte
 * Links funktionieren also unverändert weiter. Der Rückfall auf `Contract.token`
 * greift nur, solange die Migration auf einem Host noch nicht gelaufen ist —
 * danach ist er wirkungslos und kann entfallen.
 */
export async function loadContractLinkByToken(token: string) {
  const viaSignature = await loadSignatureByToken(token)
  if (viaSignature) return viaSignature

  const contract = await loadContractByToken(token)
  if (!contract) return null

  // Altbestand ohne Unterschriftszeile: aus dem Vertrag selbst eine bauen,
  // damit die Seite auch vor der Migration funktioniert.
  return {
    signature: {
      id: `legacy-${contract.id}`,
      contractId: contract.id,
      side: 'EXTERNAL',
      partyName: contract.agent
        ? `${contract.agent.firstName} ${contract.agent.lastName}`.trim()
        : 'Unbekannt',
      partyRole: null,
      sortOrder: 0,
      token: contract.token,
      signerDiscordId: contract.signerDiscordId,
      signedAt: contract.signedAt,
      signedName: contract.signedName,
      signedIp: null,
      signedUserAgent: null,
      values: contract.values,
      declinedAt: contract.declinedAt,
      declineReason: contract.declineReason,
    },
    contract,
    siblings: [] as never[],
  }
}

/**
 * Wie jemand auf einen Vertragslink zugreifen darf.
 *
 * - `signer`  — der Agent selbst: darf ausfüllen, unterschreiben, ablehnen
 * - `auditor` — Aufsichtsrolle oder HR: darf den Vertrag nur einsehen
 */
export type ContractLinkAccess = 'signer' | 'auditor'

export type ContractAccessResult =
  | { ok: true; access: ContractLinkAccess }
  | { ok: false; status: number; message: string }

/**
 * Entscheidet, ob und wie ein eingeloggter Nutzer diesen Vertrag sehen darf.
 *
 * Der Link allein reicht nie: entweder gehört der Discord-Account zum Vertrag,
 * oder er hat eine Prüfrolle bzw. das Recht, Verträge im Dashboard zu sehen.
 */
export async function resolveContractAccess(
  contract: Pick<ContractLinkRecord, 'signerDiscordId' | 'agent'>,
  user: CurrentUser | null,
): Promise<ContractAccessResult> {
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: 'Bitte melde dich mit Discord an, um diesen Vertrag zu öffnen.',
    }
  }

  // Der Agent selbst darf unterschreiben, wenn seine Discord-ID zum Vertrag
  // passt. Bewusst in zwei Stufen geprüft: erst der Snapshot, dann die aktuelle
  // Agent-Akte. HR kann die Discord-ID nachträglich korrigieren — ohne diesen
  // Fallback bliebe sonst auch der richtige Account dauerhaft ausgesperrt (403).
  const signerDiscordId = contract.signerDiscordId?.trim() || null
  const agentDiscordId = contract.agent?.discordId?.trim() || null
  const ownsContract = Boolean(user.discordId && (
    (signerDiscordId && user.discordId === signerDiscordId) ||
    (agentDiscordId && user.discordId === agentDiscordId)
  ))
  if (ownsContract) {
    return { ok: true, access: 'signer' }
  }

  // HR sieht Verträge ohnehin im Dashboard — dann darf der Link nicht strenger sein.
  if (hasAnyPermission(user, ['contracts:view', 'contracts:manage'])) {
    return { ok: true, access: 'auditor' }
  }

  if (await isDiscordContractAuditor(user.discordId)) {
    return { ok: true, access: 'auditor' }
  }

  if (!signerDiscordId && !agentDiscordId) {
    return {
      ok: false,
      status: 409,
      message:
        'Für diesen Vertrag ist keine Discord-ID hinterlegt. Bitte melde dich bei der Personalabteilung.',
    }
  }

  return {
    ok: false,
    status: 403,
    message: 'Dieser Vertrag gehört zu einem anderen Discord-Account.',
  }
}

/**
 * Bereitet den Vertrag für die Anzeige auf: Ort und Datum werden erst hier
 * eingesetzt, damit auf einem noch offenen Vertrag immer das aktuelle Datum
 * steht. Ein unterschriebener Vertrag friert stattdessen das Unterschriftsdatum
 * ein.
 */
export interface ContractDocumentSource {
  id: string
  kind?: string
  title: string
  status: string
  content: string
  closing: string | null
  clauses: unknown
  fields: unknown
  sentAt: Date | null
  counterpartyName?: string | null
  counterpartyRole?: string | null
  agent: {
    firstName: string
    lastName: string
    badgeNumber: string
    hireDate: Date
    rank: { name: string } | null
  } | null
}

/** Die Unterschriftsdaten der Zeile, aus deren Sicht das Dokument entsteht. */
export interface ContractDocumentSignature {
  token: string
  values: unknown
  signedAt: Date | null
  signedName: string | null
  declinedAt: Date | null
  declineReason: string | null
}

export async function serializeContractDocument(
  contract: ContractDocumentSource,
  signature: ContractDocumentSignature,
  access: ContractLinkAccess = 'signer',
) {
  const documentDate = signature.signedAt ?? new Date()
  const resolve = (value: string | null | undefined) =>
    value ? applyContractDatePlaceholders(value, documentDate) : ''

  const prefix = await getBadgePrefix()
  const badge = contract.agent?.badgeNumber ?? ''
  const badgeLabel = badge && prefix && !badge.startsWith(prefix)
    ? `${prefix.endsWith('-') ? prefix : `${prefix}-`}${badge}`
    : badge

  return {
    id: contract.id,
    token: signature.token,
    access,
    kind: contract.kind ?? 'AGENT',
    title: contract.title,
    status: contract.status,
    counterpartyName: contract.counterpartyName ?? null,
    counterpartyRole: contract.counterpartyRole ?? null,
    content: resolve(contract.content),
    closing: resolve(contract.closing),
    clauses: readContractClauses(contract.clauses).map((clause) => ({
      ...clause,
      title: resolve(clause.title),
      body: resolve(clause.body),
    })),
    fields: readContractFields(contract.fields),
    values: readContractValues(signature.values),
    place: CONTRACT_PLACE,
    documentDate: documentDate.toISOString(),
    sentAt: contract.sentAt,
    signedAt: signature.signedAt,
    signedName: signature.signedName,
    declinedAt: signature.declinedAt,
    declineReason: signature.declineReason,
    // Bei einem Behoerdenvertrag gibt es keinen Agent; das Dokument setzt dann
    // die Gegenpartei in den Briefkopf.
    agent: contract.agent
      ? {
          firstName: contract.agent.firstName,
          lastName: contract.agent.lastName,
          badgeNumber: badgeLabel,
          rankName: contract.agent.rank?.name ?? null,
          hireDate: contract.agent.hireDate,
        }
      : null,
  }
}

export type ContractDocument = Awaited<ReturnType<typeof serializeContractDocument>>

/**
 * Entscheidet, ob und wie jemand diese Unterschriftszeile öffnen darf.
 *
 * Gegenüber {@link resolveContractAccess} ist der Unterschied, dass eine
 * externe Partei ohne hinterlegte Identität allein über den Link zugreift —
 * eine fremde Behörde hat keinen Account in diesem Dashboard.
 */
export async function resolveSignatureAccess(
  signature: { side: string; signerDiscordId: string | null },
  agentDiscordId: string | null,
  user: CurrentUser | null,
): Promise<ContractAccessResult> {
  const linkIsProof = !signature.signerDiscordId?.trim() && !agentDiscordId?.trim()

  // Externer Vertragspartner: kein Login nötig, der Link ist der Nachweis.
  if (linkIsProof) return { ok: true, access: 'signer' }

  if (!user) {
    return {
      ok: false,
      status: 401,
      message: 'Bitte melde dich mit Discord an, um diesen Vertrag zu öffnen.',
    }
  }

  if (signerMatches(signature, agentDiscordId, user.discordId)) {
    return { ok: true, access: 'signer' }
  }

  // HR sieht Verträge ohnehin im Dashboard — dann darf der Link nicht strenger sein.
  if (hasAnyPermission(user, ['contracts:view', 'contracts:manage'])) {
    return { ok: true, access: 'auditor' }
  }
  if (await isDiscordContractAuditor(user.discordId)) {
    return { ok: true, access: 'auditor' }
  }

  return {
    ok: false,
    status: 403,
    message: 'Dieser Vertrag gehört zu einem anderen Discord-Account.',
  }
}

/** Die Parteien eines Vertrags für die Anzeige — eigene Zeile zuerst markiert. */
export function serializeParties(
  signature: {
    id: string
    side: string
    partyName: string
    partyRole: string | null
    sortOrder: number
    signedAt: Date | null
    signedName: string | null
    declinedAt: Date | null
    declineReason: string | null
  },
  siblings: readonly {
    id: string
    side: string
    partyName: string
    partyRole: string | null
    sortOrder: number
    signedAt: Date | null
    signedName: string | null
    declinedAt: Date | null
    declineReason: string | null
  }[],
): ContractLinkParty[] {
  return [
    { ...signature, own: true },
    ...siblings.map((row) => ({ ...row, own: false })),
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({
      id: row.id,
      side: row.side,
      partyName: row.partyName,
      partyRole: row.partyRole,
      sortOrder: row.sortOrder,
      signedAt: row.signedAt,
      signedName: row.signedName,
      declinedAt: row.declinedAt,
      declineReason: row.declineReason,
      state: signatureStateLabel(row),
      own: row.own,
    }))
}
