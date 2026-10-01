import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

import type { CurrentUser } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { error, forbidden, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prisma-errors'
import { nextSequenceNumber } from '@/lib/sequence-numbers'
import { lspdOfficerName, type LspdOfficerFile } from '@/lib/lspd-officers'
import {
  QUALITY_CHECK_PREFIX,
  aggregateOfficerStats,
  correctionError,
  formatQcGrade,
  qcShareCovers,
  qcShareIsActive,
  type qcCompleteSchema,
  type qcCreateSchema,
  type qcEntrySchema,
  type qcEntryUpdateSchema,
  type qcGradeSchema,
  type qcShareSchema,
  type qcShareUpdateSchema,
} from '@/lib/quality-checks'
import type { Prisma } from '@/generated/prisma'

export class QcError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export function qcRouteError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof QcError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map((issue) => issue.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe')
  console.error('[QualityChecks]', cause)
  return error('Qualitätskontrolle konnte nicht verarbeitet werden', 500)
}

export const qcDetailInclude = {
  entries: { orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] },
} as const satisfies Prisma.QualityCheckInclude

/** Der Client ist `server-only` – dynamisch, damit die Logik testbar bleibt. */
async function lspdClient() {
  return import('@/lib/lspd-hr-client')
}

async function fetchOfficer(id: string): Promise<LspdOfficerFile> {
  const { LspdUnavailableError, getLspdOfficerFile } = await lspdClient()
  try {
    return await getLspdOfficerFile(id)
  } catch (cause) {
    if (cause instanceof LspdUnavailableError) throw new QcError(cause.message, cause.status)
    throw cause
  }
}

export async function tryFetchOfficer(id: string) {
  const { tryGetLspdOfficerFile } = await lspdClient()
  return tryGetLspdOfficerFile(id)
}

async function nextQualityCheckNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.qualityCheck.findMany({ select: { number: true } })
  return nextSequenceNumber(QUALITY_CHECK_PREFIX, rows.map((row) => row.number))
}

export async function createQualityCheck(user: CurrentUser, input: z.infer<typeof qcCreateSchema>) {
  // Panel VOR der Transaktion fragen – Momentaufnahme von Name, Dienstnummer, Rang.
  const officer = await fetchOfficer(input.lspdOfficerId)

  const create = () =>
    prisma.$transaction(async (tx) => {
      const number = await nextQualityCheckNumber(tx)
      const check = await tx.qualityCheck.create({
        data: {
          number,
          lspdOfficerId: officer.id,
          officerName: lspdOfficerName(officer).slice(0, 220),
          officerBadge: officer.badgeNumber.slice(0, 100),
          officerRank: officer.rank.name.slice(0, 120),
          startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
          location: input.location || null,
          conductedById: user.id,
          conductorName: user.displayName.slice(0, 200),
        },
        include: qcDetailInclude,
      })
      await createAuditLog(
        {
          action: 'QUALITY_CHECK_STARTED',
          userId: user.id,
          details: `Qualitätskontrolle ${number} begonnen: ${check.officerName} (DN ${check.officerBadge})`,
        },
        tx,
      )
      return check
    })

  try {
    return await create()
  } catch (cause) {
    // Zwei gleichzeitige Starts bekommen sonst dieselbe Nummer.
    if (isUniqueConstraintError(cause)) return create()
    throw cause
  }
}

/** Sperrt die Kontrolle für die Dauer der Transaktion und prüft, dass sie noch läuft. */
async function lockRunningCheck(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM QualityCheck WHERE id = ${id} FOR UPDATE`
  const check = await tx.qualityCheck.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, entries: { select: { id: true, kind: true, correctsId: true } } },
  })
  if (!check) throw new QcError('Qualitätskontrolle nicht gefunden', 404)
  if (check.status !== 'RUNNING') throw new QcError('Die Kontrolle ist abgeschlossen und kann nicht mehr ergänzt werden', 409)
  return check
}

export async function addQualityEntry(user: CurrentUser, checkId: string, input: z.infer<typeof qcEntrySchema>) {
  return prisma.$transaction(async (tx) => {
    const check = await lockRunningCheck(tx, checkId)
    const problem = correctionError(check.entries, input.correctsId)
    if (problem) throw new QcError(problem, 409)

    const entry = await tx.qualityCheckEntry.create({
      data: {
        checkId,
        kind: input.kind,
        text: input.text,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        correctsId: input.correctsId ?? null,
        authorId: user.id,
        authorName: user.displayName.slice(0, 200),
      },
    })
    await createAuditLog(
      {
        action: input.correctsId ? 'QUALITY_CHECK_ENTRY_CORRECTED' : 'QUALITY_CHECK_ENTRY_ADDED',
        userId: user.id,
        details: `Qualitätskontrolle ${check.number}: ${input.kind}-Eintrag${input.correctsId ? ` (korrigiert ${input.correctsId})` : ''}`,
        newValue: input.text.slice(0, 2000),
      },
      tx,
    )
    return entry
  })
}

async function findEntry(tx: Prisma.TransactionClient, checkId: string, entryId: string) {
  const entry = await tx.qualityCheckEntry.findFirst({ where: { id: entryId, checkId } })
  if (!entry) throw new QcError('Eintrag nicht gefunden', 404)
  return entry
}

export async function updateQualityEntry(user: CurrentUser, checkId: string, entryId: string, input: z.infer<typeof qcEntryUpdateSchema>) {
  return prisma.$transaction(async (tx) => {
    const check = await lockRunningCheck(tx, checkId)
    const before = await findEntry(tx, checkId, entryId)
    const entry = await tx.qualityCheckEntry.update({
      where: { id: entryId },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
        editedAt: new Date(),
      },
    })
    await createAuditLog(
      {
        action: 'QUALITY_CHECK_ENTRY_EDITED',
        userId: user.id,
        details: `Qualitätskontrolle ${check.number}: Eintrag bearbeitet (${before.kind} → ${entry.kind})`,
        oldValue: before.text.slice(0, 2000),
        newValue: entry.text.slice(0, 2000),
      },
      tx,
    )
    return entry
  })
}

/** Löscht einen Eintrag; Korrekturen, die auf ihn verweisen, bleiben als normale Einträge stehen. */
export async function deleteQualityEntry(user: CurrentUser, checkId: string, entryId: string) {
  return prisma.$transaction(async (tx) => {
    const check = await lockRunningCheck(tx, checkId)
    const entry = await findEntry(tx, checkId, entryId)
    await tx.qualityCheckEntry.updateMany({ where: { checkId, correctsId: entryId }, data: { correctsId: null } })
    await tx.qualityCheckEntry.delete({ where: { id: entryId } })
    await createAuditLog(
      {
        action: 'QUALITY_CHECK_ENTRY_DELETED',
        userId: user.id,
        details: `Qualitätskontrolle ${check.number}: ${entry.kind}-Eintrag gelöscht`,
        oldValue: entry.text.slice(0, 2000),
      },
      tx,
    )
    return { id: entryId }
  })
}

export async function gradeQualityCheck(user: CurrentUser, id: string, input: z.infer<typeof qcGradeSchema>) {
  return prisma.$transaction(async (tx) => {
    const check = await lockRunningCheck(tx, id)
    const updated = await tx.qualityCheck.update({ where: { id }, data: { grade: input.grade }, include: qcDetailInclude })
    await createAuditLog(
      {
        action: 'QUALITY_CHECK_GRADED',
        userId: user.id,
        details: `Qualitätskontrolle ${check.number}: Note ${input.grade === null ? 'entfernt' : formatQcGrade(input.grade)}`,
      },
      tx,
    )
    return updated
  })
}

export async function completeQualityCheck(user: CurrentUser, id: string, input: z.infer<typeof qcCompleteSchema>) {
  return prisma.$transaction(async (tx) => {
    const check = await lockRunningCheck(tx, id)
    const updated = await tx.qualityCheck.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        rating: input.rating,
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
        summary: input.summary,
        endedAt: input.endedAt ? new Date(input.endedAt) : new Date(),
        ...(input.location !== undefined ? { location: input.location || null } : {}),
      },
      include: qcDetailInclude,
    })
    await createAuditLog(
      {
        action: 'QUALITY_CHECK_COMPLETED',
        userId: user.id,
        details: `Qualitätskontrolle ${check.number} abgeschlossen: ${input.rating}`,
        newValue: input.summary.slice(0, 2000),
      },
      tx,
    )
    return updated
  })
}

export async function qualityOfficerStats() {
  const rows = await prisma.qualityCheck.findMany({
    select: {
      lspdOfficerId: true,
      officerName: true,
      officerBadge: true,
      officerRank: true,
      status: true,
      rating: true,
      grade: true,
      startedAt: true,
    },
    take: 10_000,
  })
  return aggregateOfficerStats(rows)
}

/** Verknüpfte Korruptions-Beamtenakte (gleicher LSPD-Officer) mit Kurzübersicht. */
export async function linkedCorruptionFile(lspdOfficerId: string) {
  const official = await prisma.publicOfficial.findUnique({
    where: { lspdOfficerId },
    select: { id: true, mergedIntoId: true },
  })
  if (!official) return null
  const id = official.mergedIntoId ?? official.id
  const checks = await prisma.corruptionCheck.findMany({
    where: { officialId: id },
    select: { id: true, conductedAt: true, result: true },
    orderBy: { conductedAt: 'desc' },
    take: 20,
  })
  return { officialId: id, checks }
}

// ─── Freigabelinks ───────────────────────────────────────────────────────

export const qcTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export const qcSharePath = (token: string) => `/share/quality/${token}`

function newShareToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: qcTokenHash(token) }
}

export function managedQcSharesWhere(user: CurrentUser): Prisma.QualityShareWhereInput {
  return hasPermission(user, 'settings:manage') ? {} : { createdById: user.id }
}

export async function createQcShare(user: CurrentUser, input: z.infer<typeof qcShareSchema>) {
  let lspdOfficerId = input.scope === 'OFFICER' ? input.lspdOfficerId : null
  if (input.scope === 'CHECK') {
    const check = await prisma.qualityCheck.findUnique({ where: { id: input.checkId! }, select: { lspdOfficerId: true } })
    if (!check) throw new QcError('Qualitätskontrolle nicht gefunden', 404)
    lspdOfficerId = check.lspdOfficerId
  }
  if (input.scope === 'OFFICER') {
    const exists = await prisma.qualityCheck.count({ where: { lspdOfficerId: lspdOfficerId! } })
    if (exists === 0) throw new QcError('Zu diesem Beamten gibt es noch keine Qualitätskontrolle', 404)
  }

  const { token, tokenHash } = newShareToken()
  const share = await prisma.qualityShare.create({
    data: {
      title: input.title,
      tokenHash,
      scope: input.scope,
      checkId: input.scope === 'CHECK' ? input.checkId : null,
      lspdOfficerId,
      includeCareer: input.includeCareer,
      enabled: input.enabled,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdById: user.id,
    },
    omit: { tokenHash: true },
  })
  await createAuditLog({
    action: 'QUALITY_SHARE_CREATED',
    userId: user.id,
    details: `Freigabelink „${share.title}“ (${share.scope}) erstellt`,
  })
  return { share, path: qcSharePath(token) }
}

export async function updateQcShare(user: CurrentUser, id: string, input: z.infer<typeof qcShareUpdateSchema>) {
  const existing = await prisma.qualityShare.findFirst({ where: { id, ...managedQcSharesWhere(user) } })
  if (!existing) throw new QcError('Freigabelink nicht gefunden', 404)
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new QcError('Das Ablaufdatum muss in der Zukunft liegen')
  }

  const rotated = input.rotate ? newShareToken() : null
  const share = await prisma.qualityShare.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.includeCareer !== undefined ? { includeCareer: input.includeCareer } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
      ...(rotated ? { tokenHash: rotated.tokenHash } : {}),
    },
    omit: { tokenHash: true },
  })
  await createAuditLog({
    action: 'QUALITY_SHARE_UPDATED',
    userId: user.id,
    details: `Freigabelink „${share.title}“ geändert${rotated ? ' (neuer Link)' : ''}${input.enabled === false ? ' (deaktiviert)' : ''}`,
  })
  return { share, path: rotated ? qcSharePath(rotated.token) : null }
}

/** Öffentlicher Zugriff: Token → aktive Freigabe, sonst einheitlich „nicht verfügbar“. */
export async function resolveQcShare(rawToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new QcError('Link ungültig, abgelaufen oder deaktiviert', 404)
  const share = await prisma.qualityShare.findUnique({ where: { tokenHash: qcTokenHash(rawToken) } })
  if (!share || !qcShareIsActive(share)) throw new QcError('Link ungültig, abgelaufen oder deaktiviert', 404)
  void prisma.qualityShare.update({ where: { id: share.id }, data: { lastAccessAt: new Date() } }).catch(() => {})
  return share
}

type ResolvedShare = Awaited<ReturnType<typeof resolveQcShare>>

/** Alle Kontrollen im Umfang der Freigabe – laufende eingeschlossen. */
function sharedChecksWhere(share: ResolvedShare): Prisma.QualityCheckWhereInput {
  return {
    ...(share.scope === 'CHECK' ? { id: share.checkId ?? '__none__' } : {}),
    ...(share.scope === 'OFFICER' ? { lspdOfficerId: share.lspdOfficerId ?? '__none__' } : {}),
  }
}

export async function publicShareOverview(share: ResolvedShare) {
  const rows = await prisma.qualityCheck.findMany({
    where: sharedChecksWhere(share),
    select: {
      lspdOfficerId: true,
      officerName: true,
      officerBadge: true,
      officerRank: true,
      status: true,
      rating: true,
      grade: true,
      startedAt: true,
    },
    take: 10_000,
  })
  return {
    title: share.title,
    scope: share.scope,
    expiresAt: share.expiresAt,
    officers: aggregateOfficerStats(rows),
  }
}

/**
 * Beamtenakte in der Freigabe. Prüfer-Namen bleiben draußen: die Kontrollen
 * laufen verdeckt, der Link verlässt das FIB.
 */
export async function publicShareOfficer(share: ResolvedShare, lspdOfficerId: string) {
  if (!qcShareCovers(share, { lspdOfficerId, checkId: share.checkId ?? undefined })) {
    throw new QcError('Nicht Teil dieser Freigabe', 404)
  }
  const checks = await prisma.qualityCheck.findMany({
    where: { ...sharedChecksWhere(share), lspdOfficerId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      number: true,
      officerName: true,
      officerBadge: true,
      officerRank: true,
      status: true,
      rating: true,
      grade: true,
      startedAt: true,
      endedAt: true,
      location: true,
      summary: true,
      entries: {
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, kind: true, text: true, occurredAt: true, correctsId: true },
      },
    },
  })
  if (checks.length === 0) throw new QcError('Nicht Teil dieser Freigabe', 404)

  const career = share.includeCareer ? await tryFetchOfficer(lspdOfficerId) : null
  return { lspdOfficerId, career, checks }
}
