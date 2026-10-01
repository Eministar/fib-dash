import 'server-only'

import type { CurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { custodyHash, orderCustodyChain } from '@/lib/custody-chain'
import {
  CUSTODY_VIEW_THROTTLE_MS,
  currentHolder,
  type CustodyAction,
  type CustodyEventDto,
  type CustodyReport,
} from '@/lib/custody'
import type { Prisma } from '@/generated/prisma'

type Tx = Prisma.TransactionClient

export interface CustodyEvidenceRef {
  id: string
  itemNumber: string
  investigationId: string
}

export interface CustodyEventInput {
  action: CustodyAction
  actor: Pick<CurrentUser, 'id' | 'displayName'> | null
  fromHolder?: string | null
  toHolder?: string | null
  location?: string | null
  note?: string | null
}

const clip = (value: string | null | undefined, max: number) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Hängt ein Ereignis an die Kette eines Asservats. Muss in einer Transaktion
 * laufen: die Asservat-Zeile wird gesperrt, damit zwei gleichzeitige Einträge
 * nicht denselben Vorgänger bekommen (das wäre eine Gabelung).
 */
export async function appendCustodyEvent(tx: Tx, evidence: CustodyEvidenceRef, input: CustodyEventInput) {
  await tx.$queryRaw`SELECT id FROM Evidence WHERE id = ${evidence.id} FOR UPDATE`

  const chain = await tx.evidenceCustodyEvent.findMany({
    where: { chainKey: evidence.id },
    select: { hash: true, prevHash: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  // Ende der Kette: der Eintrag, auf den noch keiner verweist.
  const referenced = new Set(chain.map((event) => event.prevHash).filter(Boolean))
  const tail = chain.filter((event) => !referenced.has(event.hash)).at(-1) ?? null

  const data = {
    chainKey: evidence.id,
    evidenceId: evidence.id,
    itemNumber: evidence.itemNumber,
    investigationId: evidence.investigationId,
    action: input.action,
    actorId: input.actor?.id ?? null,
    actorName: clip(input.actor?.displayName, 200) ?? 'System',
    fromHolder: clip(input.fromHolder, 200),
    toHolder: clip(input.toHolder, 200),
    location: clip(input.location, 200),
    note: clip(input.note, 2000),
    // Ein späterer Zeitstempel als der Vorgänger hält die Anzeige stabil.
    createdAt: new Date(Math.max(Date.now(), (tail?.createdAt.getTime() ?? 0) + 1)),
  }
  const prevHash = tail?.hash ?? null

  return tx.evidenceCustodyEvent.create({
    data: { ...data, prevHash, hash: custodyHash(prevHash, data) },
  })
}

/** Wie `appendCustodyEvent`, aber mit eigener Transaktion. */
export function recordCustodyEvent(evidence: CustodyEvidenceRef, input: CustodyEventInput) {
  return prisma.$transaction((tx) => appendCustodyEvent(tx, evidence, input))
}

/**
 * Protokolliert das Einsehen – höchstens einmal je Nutzer und Zeitraum.
 * Fehler werden geschluckt: Ansehen darf nie am Protokoll scheitern.
 */
export async function recordCustodyView(evidence: CustodyEvidenceRef, user: CurrentUser) {
  try {
    const recent = await prisma.evidenceCustodyEvent.findFirst({
      where: {
        chainKey: evidence.id,
        action: 'VIEWED',
        actorId: user.id,
        createdAt: { gte: new Date(Date.now() - CUSTODY_VIEW_THROTTLE_MS) },
      },
      select: { id: true },
    })
    if (!recent) await recordCustodyEvent(evidence, { action: 'VIEWED', actor: user })
  } catch (cause) {
    console.error('[custody] Ansehen konnte nicht protokolliert werden:', cause)
  }
}

const eventSelect = {
  id: true,
  chainKey: true,
  evidenceId: true,
  itemNumber: true,
  investigationId: true,
  action: true,
  actorId: true,
  actorName: true,
  fromHolder: true,
  toHolder: true,
  location: true,
  note: true,
  prevHash: true,
  hash: true,
  createdAt: true,
} as const

type EventRow = Prisma.EvidenceCustodyEventGetPayload<{ select: typeof eventSelect }>

function toDto(event: EventRow): CustodyEventDto {
  return {
    id: event.id,
    evidenceId: event.evidenceId,
    itemNumber: event.itemNumber,
    action: event.action,
    actorName: event.actorName,
    fromHolder: event.fromHolder,
    toHolder: event.toHolder,
    location: event.location,
    note: event.note,
    hash: event.hash,
    createdAt: event.createdAt.toISOString(),
  }
}

export async function custodyReport(evidenceId: string): Promise<CustodyReport | null> {
  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    select: {
      id: true,
      itemNumber: true,
      title: true,
      kind: true,
      status: true,
      storageLocation: true,
      seizedAt: true,
      seizedLocation: true,
      investigation: { select: { id: true, caseNumber: true, title: true } },
    },
  })
  if (!evidence) return null

  const rows = await prisma.evidenceCustodyEvent.findMany({
    where: { chainKey: evidenceId },
    select: eventSelect,
    orderBy: { createdAt: 'asc' },
  })
  const { ordered, integrity } = orderCustodyChain(rows)
  const events = ordered.map(toDto)

  return {
    evidence: {
      ...evidence,
      seizedAt: evidence.seizedAt?.toISOString() ?? null,
    },
    currentHolder: currentHolder(events),
    events,
    integrity,
  }
}

/** Alle Handlungen (ohne Ansehen) einer Akte – für den Zeitstrahl. */
export async function caseCustodyEvents(investigationId: string): Promise<CustodyEventDto[]> {
  const rows = await prisma.evidenceCustodyEvent.findMany({
    where: { investigationId, action: { not: 'VIEWED' } },
    select: eventSelect,
    orderBy: { createdAt: 'asc' },
    take: 1000,
  })
  return rows.map(toDto)
}
