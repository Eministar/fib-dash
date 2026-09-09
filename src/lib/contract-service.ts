import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { sendDiscordContractMessage } from '@/lib/discord-integration'
import { agentUnitKeys } from '@/lib/agent-units'
import { getBadgePrefix } from '@/lib/settings-helpers'
import { contractUrl, resolveBaseUrl } from '@/lib/site'
import {
  DEFAULT_CONTRACT_TEMPLATE_CLAUSES,
  DEFAULT_CONTRACT_TEMPLATE_CLOSING,
  DEFAULT_CONTRACT_TEMPLATE_CONTENT,
  DEFAULT_CONTRACT_TEMPLATE_FIELDS,
  DEFAULT_CONTRACT_TEMPLATE_NAME,
  readContractClauses,
  readContractFields,
  renderContractContent,
  sanitizeContractFields,
  type ContractField,
} from '@/lib/contracts'

export const contractSelect = {
  id: true,
  kind: true,
  counterpartyName: true,
  counterpartyRole: true,
  agentId: true,
  templateId: true,
  applicationId: true,
  title: true,
  content: true,
  clauses: true,
  closing: true,
  fields: true,
  values: true,
  status: true,
  token: true,
  signerDiscordId: true,
  sentAt: true,
  sentVia: true,
  sentChannelId: true,
  sentMessageId: true,
  sendCount: true,
  lastSendError: true,
  signedAt: true,
  signedName: true,
  declinedAt: true,
  declineReason: true,
  createdAt: true,
  updatedAt: true,
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      status: true,
      rank: { select: { id: true, name: true, color: true } },
    },
  },
  template: { select: { id: true, name: true } },
  // Je Partei eine Zeile mit eigenem Link — der Arbeitsbereich zeigt sie
  // nebeneinander samt Stand.
  signatures: {
    select: {
      id: true,
      side: true,
      partyName: true,
      partyRole: true,
      sortOrder: true,
      token: true,
      signedAt: true,
      signedName: true,
      declinedAt: true,
      declineReason: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
  application: {
    select: {
      id: true,
      applicantDisplayName: true,
      status: true,
      submittedAt: true,
    },
  },
  createdBy: { select: { id: true, displayName: true } },
  signedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.ContractSelect

export type ContractRecord = Prisma.ContractGetPayload<{ select: typeof contractSelect }>

function generateContractToken() {
  return randomBytes(24).toString('base64url')
}

async function createUniqueContractToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateContractToken()
    const existing = await prisma.contract.findUnique({ where: { token }, select: { id: true } })
    if (!existing) return token
  }
  throw new Error('Vertrags-Token konnte nicht erstellt werden')
}

type AgentForContract = {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  discordId: string | null
  hireDate: Date
  unit?: string | null
  units?: unknown
  rank?: { name: string } | null
}

/**
 * Die Vorlage, die beim Anlegen eines Agents automatisch verwendet wird:
 * bevorzugt die als Standard markierte, sonst die zuletzt aktualisierte aktive.
 */
export async function getDefaultContractTemplate() {
  return prisma.contractTemplate.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
  })
}

/**
 * Legt eine Standardvorlage an, wenn noch keine existiert. So kann direkt beim
 * ersten Einstellen ein Vertrag verschickt werden, ohne dass HR vorher etwas
 * konfigurieren muss.
 */
export async function ensureDefaultContractTemplate(createdById?: string | null) {
  const existing = await getDefaultContractTemplate()
  if (existing) return existing

  return prisma.contractTemplate.create({
    data: {
      name: DEFAULT_CONTRACT_TEMPLATE_NAME,
      description: 'Automatisch angelegte Standardvorlage — kann im HR-Bereich angepasst werden.',
      content: DEFAULT_CONTRACT_TEMPLATE_CONTENT,
      clauses: DEFAULT_CONTRACT_TEMPLATE_CLAUSES as unknown as Prisma.InputJsonValue,
      closing: DEFAULT_CONTRACT_TEMPLATE_CLOSING,
      fields: DEFAULT_CONTRACT_TEMPLATE_FIELDS as unknown as Prisma.InputJsonValue,
      active: true,
      isDefault: true,
      createdById: createdById ?? null,
    },
  })
}

export interface CreateContractInput {
  agent: AgentForContract
  templateId?: string | null
  applicationId?: string | null
  createdById?: string | null
  /** Überschreibt den Vorlagentitel für diesen einen Vertrag. */
  title?: string | null
}

/**
 * Erzeugt einen Vertrag aus einer Vorlage. Inhalt und Felder werden als
 * Snapshot kopiert und die Agent-Platzhalter sofort aufgelöst — eine spätere
 * Änderung der Vorlage verändert bestehende Verträge damit nicht mehr.
 */
export async function createContractForAgent(input: CreateContractInput) {
  const template = input.templateId
    ? await prisma.contractTemplate.findUnique({ where: { id: input.templateId } })
    : await getDefaultContractTemplate()

  if (!template) throw new Error('Keine Vertragsvorlage vorhanden')
  if (!template.active) throw new Error('Diese Vertragsvorlage ist deaktiviert')

  const agent = input.agent
  const fields: ContractField[] = readContractFields(template.fields)
  const placeholderContext = {
    firstName: agent.firstName,
    lastName: agent.lastName,
    badgeNumber: agent.badgeNumber,
    rankName: agent.rank?.name ?? '',
    hireDate: agent.hireDate,
    discordId: agent.discordId,
    units: agentUnitKeys(agent),
  }

  const content = renderContractContent(template.content, placeholderContext)
  const closing = template.closing ? renderContractContent(template.closing, placeholderContext) : null
  const clauses = readContractClauses(template.clauses).map((clause) => ({
    ...clause,
    title: renderContractContent(clause.title, placeholderContext),
    body: renderContractContent(clause.body, placeholderContext),
  }))

  return prisma.contract.create({
    data: {
      templateId: template.id,
      agentId: agent.id,
      applicationId: input.applicationId ?? null,
      title: input.title?.trim() || template.name,
      content,
      clauses: clauses as unknown as Prisma.InputJsonValue,
      closing,
      fields: (fields.length > 0 ? fields : sanitizeContractFields(DEFAULT_CONTRACT_TEMPLATE_FIELDS)) as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      token: await createUniqueContractToken(),
      signerDiscordId: agent.discordId,
      createdById: input.createdById ?? null,
    },
    select: contractSelect,
  })
}

export interface SendContractMessageOptions {
  /** Request, aus dem die Basis-URL abgeleitet wird, falls kein NEXT_PUBLIC_SITE_URL gesetzt ist. */
  req?: { url: string; headers: Headers }
  note?: string | null
}

/**
 * Verschickt (oder wiederholt) die Vertragsnachricht und protokolliert das
 * Ergebnis am Vertrag. Ein fehlgeschlagener Versand wirft nicht, sondern wird
 * am Datensatz vermerkt — der Vertrag selbst bleibt gültig und kann erneut
 * gesendet werden.
 */
export async function sendContractMessage(contractId: string, options: SendContractMessageOptions = {}) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: contractSelect,
  })
  if (!contract) throw new Error('Vertrag nicht gefunden')
  if (contract.status === 'SIGNED') throw new Error('Dieser Vertrag ist bereits unterschrieben')
  if (contract.status === 'CANCELLED') throw new Error('Dieser Vertrag wurde zurückgezogen')

  // Der Discord-Versand richtet sich an den Agent. Ein Behoerdenvertrag hat
  // keinen — dessen Link wird kopiert und ueber einen eigenen Kanal
  // weitergegeben.
  const agent = contract.agent
  if (!agent) {
    throw new Error(
      'Behördenverträge werden nicht über Discord verschickt. Bitte den Signaturlink kopieren und weitergeben.',
    )
  }

  const baseUrl = resolveBaseUrl(options.req)
  if (!baseUrl) {
    throw new Error('Basis-URL unbekannt — bitte NEXT_PUBLIC_SITE_URL setzen')
  }

  const prefix = await getBadgePrefix()
  const badgeLabel = prefix && !agent.badgeNumber.startsWith(prefix)
    ? `${prefix.endsWith('-') ? prefix : `${prefix}-`}${agent.badgeNumber}`
    : agent.badgeNumber

  const result = await sendDiscordContractMessage({
    discordId: agent.discordId,
    agentName: `${agent.firstName} ${agent.lastName}`.trim(),
    badgeNumber: badgeLabel,
    rankName: agent.rank?.name ?? null,
    contractTitle: contract.title,
    contractUrl: contractUrl(baseUrl, contract.token),
    reminder: contract.sendCount > 0,
    note: options.note ?? null,
  })

  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      status: result.delivered && contract.status === 'DRAFT' ? 'SENT' : contract.status,
      sentAt: result.delivered ? new Date() : contract.sentAt,
      sentVia: result.via ?? contract.sentVia,
      sentChannelId: result.channelId ?? contract.sentChannelId,
      sentMessageId: result.messageId ?? contract.sentMessageId,
      sendCount: result.delivered ? contract.sendCount + 1 : contract.sendCount,
      lastSendError: result.error,
    },
    select: contractSelect,
  })

  return { contract: updated, result }
}

/**
 * Erstellt bei Bedarf einen Vertrag für einen frisch angelegten Agent und
 * verschickt ihn. Läuft „best effort“ — schlägt etwas fehl, wird das geloggt,
 * aber die Einstellung selbst nicht blockiert.
 */
export async function queueContractForNewAgent(input: {
  agent: AgentForContract
  templateId?: string | null
  applicationId?: string | null
  createdById?: string | null
  req?: { url: string; headers: Headers }
}) {
  try {
    const template = input.templateId
      ? await prisma.contractTemplate.findUnique({ where: { id: input.templateId } })
      : await ensureDefaultContractTemplate(input.createdById)
    if (!template) return null

    const contract = await createContractForAgent({
      agent: input.agent,
      templateId: template.id,
      applicationId: input.applicationId ?? null,
      createdById: input.createdById ?? null,
    })

    const { result } = await sendContractMessage(contract.id, { req: input.req })
    if (!result.delivered) {
      console.warn('[Contracts] Vertragsnachricht konnte nicht zugestellt werden:', result.error)
    }
    return contract
  } catch (error) {
    console.error('[Contracts] Automatischer Vertragsversand fehlgeschlagen:', error)
    return null
  }
}

/** Offene (noch nicht unterschriebene) Verträge eines Agents. */
export function openContractWhere(agentId: string): Prisma.ContractWhereInput {
  return { agentId, status: { in: ['DRAFT', 'SENT'] } }
}

export type AgentContractSummary = {
  /** Es existiert ein unterschriebener Vertrag. */
  signed: boolean
  /** Es liegt ein versendeter/erstellter, aber noch offener Vertrag vor. */
  pending: boolean
  /** Weder unterschrieben noch offen — es wurde nie ein Vertrag angelegt. */
  missing: boolean
  /** Der Agent darf noch nicht als vollständig eingestellt gelten. */
  blocksOnboarding: boolean
  contractId: string | null
  signedAt: Date | null
  sentAt: Date | null
}

type ContractStateRow = {
  id: string
  status: string
  signedAt: Date | null
  sentAt: Date | null
  createdAt: Date
}

/**
 * Fasst den Vertragsstand eines Agents zusammen.
 *
 * Ein Agent gilt erst als vollständig eingestellt, wenn ein Vertrag
 * unterschrieben vorliegt. Abgelehnte oder zurückgezogene Verträge zählen dabei
 * nicht als offen — dort muss HR einen neuen Vertrag anstoßen.
 */
export function summarizeAgentContracts(contracts: ContractStateRow[]): AgentContractSummary {
  const signedContract = contracts.find((contract) => contract.status === 'SIGNED') ?? null
  const openContract = contracts.find(
    (contract) => contract.status === 'DRAFT' || contract.status === 'SENT',
  ) ?? null

  const signed = Boolean(signedContract)
  const pending = !signed && Boolean(openContract)

  return {
    signed,
    pending,
    missing: !signed && !openContract,
    blocksOnboarding: !signed,
    contractId: signedContract?.id ?? openContract?.id ?? contracts[0]?.id ?? null,
    signedAt: signedContract?.signedAt ?? null,
    sentAt: openContract?.sentAt ?? signedContract?.sentAt ?? null,
  }
}

