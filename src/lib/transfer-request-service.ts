import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { nextSequenceNumber } from '@/lib/sequence-numbers'
import {
  applyContractDatePlaceholders,
  readContractClauses,
  readContractFields,
  readContractValues,
  renderContractContent,
  CONTRACT_PLACE,
} from '@/lib/contracts'
import {
  DEFAULT_TRANSFER_CLAUSES,
  DEFAULT_TRANSFER_CLOSING,
  DEFAULT_TRANSFER_CONTENT,
  DEFAULT_TRANSFER_FIELDS,
  DEFAULT_TRANSFER_TITLE,
  SIGNATURE_ROLES,
  TRANSFER_REQUEST_PREFIX,
  isFullySigned,
  type SignatureRole,
} from '@/lib/transfer-requests'

const MAX_ATTEMPTS = 5

export const transferRequestSelect = {
  id: true,
  token: true,
  requestNumber: true,
  agentId: true,
  agentName: true,
  badgeNumber: true,
  rankName: true,
  signerDiscordId: true,
  title: true,
  content: true,
  clauses: true,
  closing: true,
  fields: true,
  values: true,
  targetAuthority: true,
  status: true,
  hrSignedName: true,
  hrSignedAt: true,
  agentSignedName: true,
  agentSignedAt: true,
  authoritySignedName: true,
  authoritySignedRole: true,
  authoritySignedAt: true,
  sentAt: true,
  declinedAt: true,
  declineReason: true,
  createdAt: true,
  updatedAt: true,
  agent: {
    select: { id: true, firstName: true, lastName: true, badgeNumber: true, discordId: true },
  },
  createdBy: { select: { id: true, displayName: true } },
  hrSignedBy: { select: { id: true, displayName: true } },
  agentSignedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TransferRequestSelect

export type TransferRequestRecord = Prisma.TransferRequestGetPayload<{ select: typeof transferRequestSelect }>

async function createUniqueToken() {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const token = randomBytes(24).toString('base64url')
    const existing = await prisma.transferRequest.findUnique({ where: { token }, select: { id: true } })
    if (!existing) return token
  }
  throw new Error('Link-Token konnte nicht erzeugt werden')
}

async function nextRequestNumber() {
  const rows = await prisma.transferRequest.findMany({ select: { requestNumber: true } })
  return nextSequenceNumber(TRANSFER_REQUEST_PREFIX, rows.map((row) => row.requestNumber))
}

/**
 * Legt einen Versetzungsantrag für einen Agent an. Inhalt, Regelungen und
 * Felder sind Snapshots — spätere Änderungen an den Vorlagen dürfen einen
 * bereits verschickten Antrag nicht nachträglich verändern.
 */
export async function createTransferRequest(input: {
  agentId: string
  title?: string
  targetAuthority?: string | null
  createdById: string
}) {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      badgeNumber: true,
      discordId: true,
      hireDate: true,
      unit: true,
      units: true,
      rank: { select: { name: true } },
    },
  })
  if (!agent) throw new Error('Agent nicht gefunden')

  const content = renderContractContent(DEFAULT_TRANSFER_CONTENT, {
    firstName: agent.firstName,
    lastName: agent.lastName,
    badgeNumber: agent.badgeNumber,
    rankName: agent.rank?.name ?? '',
    hireDate: agent.hireDate,
    discordId: agent.discordId,
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.transferRequest.create({
        data: {
          token: await createUniqueToken(),
          requestNumber: await nextRequestNumber(),
          agentId: agent.id,
          agentName: `${agent.firstName} ${agent.lastName}`.trim(),
          badgeNumber: agent.badgeNumber,
          rankName: agent.rank?.name ?? null,
          signerDiscordId: agent.discordId,
          title: input.title?.trim() || DEFAULT_TRANSFER_TITLE,
          content,
          clauses: DEFAULT_TRANSFER_CLAUSES as unknown as Prisma.InputJsonValue,
          closing: DEFAULT_TRANSFER_CLOSING,
          fields: DEFAULT_TRANSFER_FIELDS as unknown as Prisma.InputJsonValue,
          targetAuthority: input.targetAuthority?.trim() || null,
          status: 'SENT',
          sentAt: new Date(),
          createdById: input.createdById,
        },
        select: transferRequestSelect,
      })
    } catch (e: unknown) {
      if (!isUniqueConstraintError(e) || attempt === MAX_ATTEMPTS) throw e
    }
  }

  throw new Error('Versetzungsantrag konnte nicht angelegt werden')
}

export async function loadTransferRequestByToken(token: string) {
  if (!token) return null
  const request = await prisma.transferRequest.findUnique({
    where: { token },
    select: transferRequestSelect,
  })
  // MySQL vergleicht Strings standardmäßig case-insensitiv — der Token muss
  // deshalb exakt nachgeprüft werden.
  return request && request.token === token ? request : null
}

export function transferSignatures(request: TransferRequestRecord) {
  return [
    {
      role: 'HR' as SignatureRole,
      name: request.hrSignedName,
      signedAt: request.hrSignedAt ? request.hrSignedAt.toISOString() : null,
      roleLabel: null,
    },
    {
      role: 'AGENT' as SignatureRole,
      name: request.agentSignedName,
      signedAt: request.agentSignedAt ? request.agentSignedAt.toISOString() : null,
      roleLabel: null,
    },
    {
      role: 'AUTHORITY' as SignatureRole,
      name: request.authoritySignedName,
      signedAt: request.authoritySignedAt ? request.authoritySignedAt.toISOString() : null,
      roleLabel: request.authoritySignedRole,
    },
  ]
}

/**
 * Status aus den Unterschriften ableiten. Abgelehnte und zurückgezogene
 * Anträge behalten ihren Endzustand.
 */
export function deriveTransferStatus(request: TransferRequestRecord) {
  if (request.status === 'DECLINED' || request.status === 'CANCELLED') return request.status
  const signatures = transferSignatures(request)
  if (isFullySigned(signatures)) return 'COMPLETED' as const
  if (signatures.some((signature) => signature.signedAt)) return 'IN_SIGNING' as const
  return request.status === 'DRAFT' ? ('DRAFT' as const) : ('SENT' as const)
}

/** Serialisiert den Antrag für das Dokument auf der öffentlichen Seite. */
export function serializeTransferRequest(request: TransferRequestRecord) {
  const signedDate = request.authoritySignedAt ?? request.agentSignedAt ?? request.hrSignedAt ?? null
  const status = deriveTransferStatus(request)

  return {
    id: request.id,
    token: request.token,
    requestNumber: request.requestNumber,
    title: request.title,
    status,
    content: applyContractDatePlaceholders(request.content, signedDate),
    closing: applyContractDatePlaceholders(request.closing ?? '', signedDate),
    clauses: readContractClauses(request.clauses).map((clause) => ({
      ...clause,
      body: applyContractDatePlaceholders(clause.body, signedDate),
    })),
    fields: readContractFields(request.fields),
    values: readContractValues(request.values),
    place: CONTRACT_PLACE,
    documentDate: (signedDate ?? request.createdAt).toISOString(),
    targetAuthority: request.targetAuthority,
    agent: {
      name: request.agentName,
      badgeNumber: request.badgeNumber,
      rankName: request.rankName,
    },
    signatures: transferSignatures(request),
    openRoles: SIGNATURE_ROLES.filter((role) => (
      !transferSignatures(request).some((signature) => signature.role === role && signature.signedAt)
    )),
    declinedAt: request.declinedAt ? request.declinedAt.toISOString() : null,
    declineReason: request.declineReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  }
}

export type TransferRequestDocument = ReturnType<typeof serializeTransferRequest>
