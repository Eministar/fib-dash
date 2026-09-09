import { randomBytes } from 'node:crypto'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveContractStatus } from '@/lib/contract-signatures'
import {
  normalizeLinkToken,
  sanitizeContractFields,
  type ContractClause,
  type ContractField,
  type ContractStatusValue,
  type ContractValues,
} from '@/lib/contracts'

/** Wie `createUniqueContractToken` in contract-service.ts — gleiche Länge, gleiche Form. */
async function createUniqueSignatureToken() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = randomBytes(24).toString('base64url')
    const taken = await prisma.contractSignature.findUnique({ where: { token }, select: { id: true } })
    if (!taken) return token
  }
  throw new Error('Konnte keinen eindeutigen Vertragslink erzeugen')
}

export interface AgencyPartyInput {
  partyName: string
  partyRole?: string | null
  /** Nur für die eigene Seite: dann muss sich der Unterzeichner per Discord ausweisen. */
  signerDiscordId?: string | null
}

export interface CreateAgencyContractInput {
  title: string
  content: string
  clauses: ContractClause[]
  closing: string | null
  fields: ContractField[]
  ownParty: AgencyPartyInput
  counterparty: AgencyPartyInput
  templateId?: string | null
  createdById?: string | null
}

/**
 * Legt einen Vertrag mit einer externen Behörde an — frei geschrieben, ohne
 * Vorlagenzwang. Es entstehen zwei Unterschriftszeilen, jede mit eigenem Link.
 *
 * Anders als bei `createContractForAgent` werden keine Platzhalter aufgelöst:
 * es gibt keinen Agent, dessen Daten einzusetzen wären.
 */
export async function createAgencyContract(input: CreateAgencyContractInput) {
  const fields = sanitizeContractFields(input.fields)

  return prisma.contract.create({
    data: {
      kind: 'AGENCY',
      templateId: input.templateId ?? null,
      agentId: null,
      title: input.title.trim().slice(0, 200),
      content: input.content,
      clauses: input.clauses as unknown as Prisma.InputJsonValue,
      closing: input.closing,
      fields: fields as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      // Der Vertrag selbst trägt weiterhin einen Token, damit die alte Spalte
      // ihre Unique-Bedingung behält. Verschickt werden die Token der Zeilen.
      token: await createUniqueSignatureToken(),
      counterpartyName: input.counterparty.partyName.trim().slice(0, 200),
      counterpartyRole: input.counterparty.partyRole?.trim().slice(0, 200) || null,
      createdById: input.createdById ?? null,
      signatures: {
        create: [
          {
            side: 'INTERNAL',
            partyName: input.ownParty.partyName.trim().slice(0, 200),
            partyRole: input.ownParty.partyRole?.trim().slice(0, 200) || null,
            sortOrder: 0,
            token: await createUniqueSignatureToken(),
            signerDiscordId: input.ownParty.signerDiscordId?.trim() || null,
          },
          {
            side: 'EXTERNAL',
            partyName: input.counterparty.partyName.trim().slice(0, 200),
            partyRole: input.counterparty.partyRole?.trim().slice(0, 200) || null,
            sortOrder: 1,
            token: await createUniqueSignatureToken(),
            // Eine fremde Behörde hat keinen Account: der Link ist der Nachweis.
            signerDiscordId: null,
          },
        ],
      },
    },
  })
}

const signatureSelect = {
  id: true,
  contractId: true,
  side: true,
  partyName: true,
  partyRole: true,
  sortOrder: true,
  token: true,
  signerDiscordId: true,
  signedAt: true,
  signedName: true,
  signedIp: true,
  signedUserAgent: true,
  values: true,
  declinedAt: true,
  declineReason: true,
} as const

/**
 * Sucht die Unterschriftszeile zum Link-Token und liefert Vertrag und
 * Gegenseite dazu.
 *
 * MySQL vergleicht Strings mit der Standard-Kollation ohne Rücksicht auf Groß-
 * und Kleinschreibung — deshalb wird zusätzlich exakt nachgeprüft, wie schon
 * bei `loadContractByToken`.
 */
export async function loadSignatureByToken(rawToken: string) {
  const token = normalizeLinkToken(rawToken)
  if (!token) return null

  const signature = await prisma.contractSignature.findUnique({
    where: { token },
    select: {
      ...signatureSelect,
      contract: {
        select: {
          id: true,
          kind: true,
          title: true,
          content: true,
          clauses: true,
          closing: true,
          fields: true,
          status: true,
          counterpartyName: true,
          counterpartyRole: true,
          sentAt: true,
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
        },
      },
    },
  })
  if (!signature) return null
  if (signature.token !== token) return null

  const siblings = await prisma.contractSignature.findMany({
    where: { contractId: signature.contractId, id: { not: signature.id } },
    select: signatureSelect,
    orderBy: { sortOrder: 'asc' },
  })

  return { signature, contract: signature.contract, siblings }
}

/**
 * Rechnet den Vertragsstatus aus allen Zeilen neu aus. Läuft nach jeder
 * Unterschrift und jeder Ablehnung — der Status ist abgeleitet, nie gesetzt.
 */
export async function refreshContractStatus(contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, status: true, signatures: { select: { signedAt: true, declinedAt: true } } },
  })
  if (!contract) return null

  const next = deriveContractStatus(contract.signatures, contract.status as ContractStatusValue)
  if (next === contract.status) return contract.status as ContractStatusValue

  await prisma.contract.update({ where: { id: contractId }, data: { status: next } })
  return next
}

export interface SignInput {
  values: ContractValues
  signedName: string
  userId: string | null
  ip: string | null
  userAgent: string | null
}

/** Trägt die Unterschrift genau einer Partei ein. */
export async function signWithToken(rawToken: string, input: SignInput) {
  const found = await loadSignatureByToken(rawToken)
  if (!found) return null

  await prisma.contractSignature.update({
    where: { id: found.signature.id },
    data: {
      signedAt: new Date(),
      signedName: input.signedName.slice(0, 200) || null,
      signedByUserId: input.userId,
      signedIp: input.ip,
      signedUserAgent: input.userAgent,
      values: input.values as unknown as Prisma.InputJsonValue,
      declinedAt: null,
      declineReason: null,
    },
  })

  const status = await refreshContractStatus(found.contract.id)
  return { signatureId: found.signature.id, contractId: found.contract.id, status }
}

/** Trägt die Ablehnung einer Partei ein. */
export async function declineWithToken(rawToken: string, reason: string | null) {
  const found = await loadSignatureByToken(rawToken)
  if (!found) return null

  await prisma.contractSignature.update({
    where: { id: found.signature.id },
    data: {
      declinedAt: new Date(),
      declineReason: reason?.slice(0, 1000) || null,
      signedAt: null,
      signedName: null,
    },
  })

  const status = await refreshContractStatus(found.contract.id)
  return { signatureId: found.signature.id, contractId: found.contract.id, status }
}
