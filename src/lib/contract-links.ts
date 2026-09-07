import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/auth'
import { isDiscordContractAuditor } from '@/lib/discord-integration'
import { hasAnyPermission } from '@/lib/permissions'
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
export async function serializeContractDocument(
  contract: ContractLinkRecord,
  access: ContractLinkAccess = 'signer',
) {
  const documentDate = contract.signedAt ?? new Date()
  const resolve = (value: string | null | undefined) =>
    value ? applyContractDatePlaceholders(value, documentDate) : ''

  const prefix = await getBadgePrefix()
  const badge = contract.agent.badgeNumber
  const badgeLabel = prefix && !badge.startsWith(prefix)
    ? `${prefix.endsWith('-') ? prefix : `${prefix}-`}${badge}`
    : badge

  return {
    id: contract.id,
    token: contract.token,
    access,
    title: contract.title,
    status: contract.status,
    content: resolve(contract.content),
    closing: resolve(contract.closing),
    clauses: readContractClauses(contract.clauses).map((clause) => ({
      ...clause,
      title: resolve(clause.title),
      body: resolve(clause.body),
    })),
    fields: readContractFields(contract.fields),
    values: readContractValues(contract.values),
    place: CONTRACT_PLACE,
    documentDate: documentDate.toISOString(),
    sentAt: contract.sentAt,
    signedAt: contract.signedAt,
    signedName: contract.signedName,
    declinedAt: contract.declinedAt,
    declineReason: contract.declineReason,
    agent: {
      firstName: contract.agent.firstName,
      lastName: contract.agent.lastName,
      badgeNumber: badgeLabel,
      rankName: contract.agent.rank?.name ?? null,
      hireDate: contract.agent.hireDate,
    },
  }
}

export type ContractDocument = Awaited<ReturnType<typeof serializeContractDocument>>
