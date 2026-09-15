import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { normalizeLinkToken } from './link-tokens'
import { readContractClauses } from './contracts'
import {
  deriveAgreementStatus,
  normalizeClauses,
  type AgreementInput,
  type AgreementLetterhead,
  type AgreementStatus,
  type TemplateInput,
} from './agreements'

export class AgreementError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export const createPartyToken = () => randomBytes(32).toString('base64url')

const json = (value: unknown) => value as Prisma.InputJsonValue

export const agreementSelect = {
  id: true,
  title: true,
  status: true,
  letterhead: true,
  content: true,
  clauses: true,
  closing: true,
  templateId: true,
  releasedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { displayName: true } },
  parties: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, role: true, sortOrder: true, token: true, signedAt: true, signedName: true, declinedAt: true, declineReason: true },
  },
} satisfies Prisma.AgreementSelect

export const agreementListSelect = {
  id: true,
  title: true,
  status: true,
  letterhead: true,
  updatedAt: true,
  parties: { orderBy: { sortOrder: 'asc' }, select: { name: true, signedAt: true, declinedAt: true } },
} satisfies Prisma.AgreementSelect

async function assertTemplate(templateId: string | null | undefined) {
  if (!templateId) return null
  const template = await prisma.agreementTemplate.findUnique({ where: { id: templateId }, select: { id: true } })
  if (!template) throw new AgreementError('Vorlage nicht gefunden', 404)
  return template.id
}

/** Unterscheidet „gibt es nicht“ (404) von „Zustand passt nicht“ (409). */
async function conflictOrMissing(id: string, message: string): Promise<never> {
  const exists = await prisma.agreement.findUnique({ where: { id }, select: { id: true } })
  throw exists ? new AgreementError(message, 409) : new AgreementError('Vertrag nicht gefunden', 404)
}

export async function createAgreement(input: AgreementInput, userId: string | null) {
  const templateId = await assertTemplate(input.templateId)
  return prisma.agreement.create({
    data: {
      title: input.title,
      letterhead: input.letterhead,
      content: input.content,
      clauses: json(normalizeClauses(input.clauses)),
      closing: input.closing?.trim() || null,
      templateId,
      createdById: userId,
      parties: {
        create: input.parties.map((party, index) => ({ name: party.name, role: party.role || null, sortOrder: index, token: createPartyToken() })),
      },
    },
    select: agreementSelect,
  })
}

export async function updateAgreement(id: string, input: AgreementInput) {
  const templateId = await assertTemplate(input.templateId)
  return prisma.$transaction(async (tx) => {
    const current = await tx.agreement.findUnique({ where: { id }, select: { status: true, parties: { select: { id: true } } } })
    if (!current) throw new AgreementError('Vertrag nicht gefunden', 404)
    if (current.status !== 'DRAFT') throw new AgreementError('Nur Entwürfe können bearbeitet werden', 409)

    // Bestehende Parteien behalten ihren Link, damit bereits kopierte Links gültig bleiben.
    const existing = new Set(current.parties.map((party) => party.id))
    const kept = new Set(input.parties.map((party) => party.id).filter((partyId): partyId is string => !!partyId && existing.has(partyId)))
    await tx.agreementParty.deleteMany({ where: { agreementId: id, id: { notIn: [...kept] } } })
    for (const [index, party] of input.parties.entries()) {
      const data = { name: party.name, role: party.role || null, sortOrder: index }
      if (party.id && kept.has(party.id)) await tx.agreementParty.update({ where: { id: party.id }, data })
      else await tx.agreementParty.create({ data: { ...data, agreementId: id, token: createPartyToken() } })
    }

    return tx.agreement.update({
      where: { id },
      data: {
        title: input.title,
        letterhead: input.letterhead,
        content: input.content,
        clauses: json(normalizeClauses(input.clauses)),
        closing: input.closing?.trim() || null,
        templateId,
      },
      select: agreementSelect,
    })
  })
}

export async function deleteAgreement(id: string) {
  const result = await prisma.agreement.deleteMany({ where: { id, status: 'DRAFT' } })
  if (result.count === 0) await conflictOrMissing(id, 'Nur Entwürfe können gelöscht werden')
}

export async function releaseAgreement(id: string) {
  const current = await prisma.agreement.findUnique({ where: { id }, select: { title: true, _count: { select: { parties: true } } } })
  if (!current) throw new AgreementError('Vertrag nicht gefunden', 404)
  if (!current.title.trim()) throw new AgreementError('Titel ist erforderlich')
  if (current._count.parties === 0) throw new AgreementError('Mindestens eine Partei angeben')
  const result = await prisma.agreement.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'OPEN', releasedAt: new Date() } })
  if (result.count === 0) await conflictOrMissing(id, 'Nur Entwürfe können freigegeben werden')
  return prisma.agreement.findUniqueOrThrow({ where: { id }, select: agreementSelect })
}

export async function cancelAgreement(id: string) {
  const result = await prisma.agreement.updateMany({
    where: { id, status: { in: ['DRAFT', 'OPEN'] } },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })
  if (result.count === 0) await conflictOrMissing(id, 'Dieser Vertrag kann nicht mehr zurückgezogen werden')
  return prisma.agreement.findUniqueOrThrow({ where: { id }, select: agreementSelect })
}

export async function duplicateAgreement(id: string, userId: string | null) {
  const source = await prisma.agreement.findUnique({ where: { id }, select: agreementSelect })
  if (!source) throw new AgreementError('Vertrag nicht gefunden', 404)
  return prisma.agreement.create({
    data: {
      title: `${source.title} (Kopie)`.slice(0, 200),
      letterhead: source.letterhead,
      content: source.content,
      clauses: json(source.clauses),
      closing: source.closing,
      templateId: source.templateId,
      createdById: userId,
      parties: {
        create: source.parties.map((party, index) => ({ name: party.name, role: party.role, sortOrder: index, token: createPartyToken() })),
      },
    },
    select: agreementSelect,
  })
}

export async function regeneratePartyToken(agreementId: string, partyId: string) {
  const token = createPartyToken()
  const result = await prisma.agreementParty.updateMany({
    where: { id: partyId, agreementId, signedAt: null, declinedAt: null, agreement: { is: { status: { in: ['DRAFT', 'OPEN'] } } } },
    data: { token },
  })
  if (result.count === 0) {
    const exists = await prisma.agreementParty.findFirst({ where: { id: partyId, agreementId }, select: { id: true } })
    throw exists ? new AgreementError('Für diese Partei kann kein neuer Link mehr erzeugt werden', 409) : new AgreementError('Partei nicht gefunden', 404)
  }
  return token
}

const linkPartySelect = {
  id: true,
  token: true,
  name: true,
  role: true,
  signedAt: true,
  signedName: true,
  declinedAt: true,
  agreement: {
    select: {
      id: true,
      title: true,
      status: true,
      letterhead: true,
      content: true,
      clauses: true,
      closing: true,
      releasedAt: true,
      // Andere Parteien nur mit dem, was auf dem Dokument steht – nie Token, IP oder User-Agent.
      parties: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, role: true, signedAt: true, signedName: true, declinedAt: true },
      },
    },
  },
} satisfies Prisma.AgreementPartySelect

const defaultPartyLookup = async (token: string) =>
  prisma.agreementParty.findUnique({ where: { token }, select: linkPartySelect })

export type LinkParty = NonNullable<Awaited<ReturnType<typeof defaultPartyLookup>>>

export async function loadPartyByToken(raw: string, lookup: (token: string) => Promise<LinkParty | null> = defaultPartyLookup) {
  const token = normalizeLinkToken(raw)
  if (!token) return null
  const party = await lookup(token)
  // Die Kollation vergleicht ohne Groß-/Kleinschreibung – daher exakt nachprüfen.
  return party && party.token === token ? party : null
}

export function serializeLink(party: LinkParty) {
  const { agreement } = party
  return {
    party: { name: party.name, role: party.role, signedAt: party.signedAt, signedName: party.signedName, declinedAt: party.declinedAt },
    canSign: agreement.status === 'OPEN' && !party.signedAt && !party.declinedAt,
    agreement: {
      title: agreement.title,
      status: agreement.status as AgreementStatus,
      letterhead: agreement.letterhead as AgreementLetterhead,
      content: agreement.content,
      clauses: readContractClauses(agreement.clauses),
      closing: agreement.closing,
      releasedAt: agreement.releasedAt,
      parties: agreement.parties,
    },
  }
}

/**
 * Läuft bewusst nach dem Schreiben und außerhalb einer Transaktion: Unterschreiben
 * zwei Parteien gleichzeitig, sieht der zuletzt laufende Abgleich beide Zeilen.
 */
async function syncAgreementStatus(agreementId: string) {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: { status: true, parties: { select: { signedAt: true, declinedAt: true } } },
  })
  if (!agreement) return null
  const next = deriveAgreementStatus(agreement.status as AgreementStatus, agreement.parties)
  if (next !== agreement.status) await prisma.agreement.updateMany({ where: { id: agreementId, status: 'OPEN' }, data: { status: next } })
  return next
}

async function writeParty(token: string, data: Prisma.AgreementPartyUpdateManyMutationInput) {
  const party = await loadPartyByToken(token)
  if (!party) throw new AgreementError('Link ungültig', 404)
  const result = await prisma.agreementParty.updateMany({
    where: { id: party.id, signedAt: null, declinedAt: null, agreement: { is: { status: 'OPEN' } } },
    data,
  })
  if (result.count === 0) throw new AgreementError('Über diesen Link kann nicht mehr unterschrieben werden', 409)
  return syncAgreementStatus(party.agreement.id)
}

export function signParty(token: string, input: { name: string; ip: string | null; userAgent: string | null }) {
  return writeParty(token, { signedAt: new Date(), signedName: input.name, signedIp: input.ip, signedUserAgent: input.userAgent })
}

export function declineParty(token: string, reason: string | null) {
  return writeParty(token, { declinedAt: new Date(), declineReason: reason })
}

export const templateSelect = {
  id: true,
  name: true,
  letterhead: true,
  content: true,
  clauses: true,
  closing: true,
  updatedAt: true,
} satisfies Prisma.AgreementTemplateSelect

export function listTemplates() {
  return prisma.agreementTemplate.findMany({ orderBy: { name: 'asc' }, select: templateSelect })
}

export function createTemplate(input: TemplateInput, userId: string | null) {
  return prisma.agreementTemplate.create({
    data: { name: input.name, letterhead: input.letterhead, content: input.content, clauses: json(normalizeClauses(input.clauses)), closing: input.closing?.trim() || null, createdById: userId },
    select: templateSelect,
  })
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const exists = await prisma.agreementTemplate.findUnique({ where: { id }, select: { id: true } })
  if (!exists) throw new AgreementError('Vorlage nicht gefunden', 404)
  return prisma.agreementTemplate.update({
    where: { id },
    data: { name: input.name, letterhead: input.letterhead, content: input.content, clauses: json(normalizeClauses(input.clauses)), closing: input.closing?.trim() || null },
    select: templateSelect,
  })
}

export async function deleteTemplate(id: string) {
  const result = await prisma.agreementTemplate.deleteMany({ where: { id } })
  if (result.count === 0) throw new AgreementError('Vorlage nicht gefunden', 404)
}
