/**
 * Qualitätskontrollen von LSPD-Beamten (verdeckte Mitfahrt). Reine Logik,
 * Typen und Eingabeprüfung – Client und Server nutzen dieselbe Quelle.
 */
import { z } from 'zod'

import { cleanLspdBadge, lspdOfficerName, lspdStatusLabel, type LspdOfficer } from '@/lib/lspd-officers'

export const QUALITY_CHECK_PREFIX = 'QK-'

export const QC_ENTRY_KINDS = ['POSITIVE', 'NEGATIVE', 'NOTE'] as const
export type QcEntryKind = (typeof QC_ENTRY_KINDS)[number]
export const QC_ENTRY_KIND_LABELS: Record<QcEntryKind, string> = {
  POSITIVE: 'Positiv',
  NEGATIVE: 'Negativ',
  NOTE: 'Notiz',
}

export const QC_RATINGS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const
export type QcRating = (typeof QC_RATINGS)[number]
export const QC_RATING_LABELS: Record<QcRating, string> = {
  POSITIVE: 'Positiv',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negativ',
}

export const QC_GRADES = [1, 2, 3, 4, 5, 6] as const
export type QcGrade = (typeof QC_GRADES)[number]
export const QC_GRADE_LABELS: Record<QcGrade, string> = {
  1: 'Sehr gut',
  2: 'Gut',
  3: 'Befriedigend',
  4: 'Ausreichend',
  5: 'Mangelhaft',
  6: 'Ungenügend',
}
export const isQcGrade = (value: unknown): value is QcGrade => QC_GRADES.includes(value as QcGrade)

const gradeSchema = z.number().int().min(1, 'Note 1 bis 6').max(6, 'Note 1 bis 6')

export const QC_STATUS_LABELS: Record<string, string> = {
  RUNNING: 'Läuft',
  COMPLETED: 'Abgeschlossen',
}

export const QC_SHARE_SCOPES = ['CHECK', 'OFFICER', 'ALL'] as const
export type QcShareScope = (typeof QC_SHARE_SCOPES)[number]
export const QC_SHARE_SCOPE_LABELS: Record<QcShareScope, string> = {
  CHECK: 'Eine Kontrolle',
  OFFICER: 'Eine Beamtenakte',
  ALL: 'Alle Beamtenakten',
}

const isoDate = z.iso.datetime({ offset: true })
const notInFuture = (value: string) => new Date(value).getTime() <= Date.now() + 5 * 60_000

export const qcCreateSchema = z
  .object({
    lspdOfficerId: z.string().trim().min(1).max(191),
    startedAt: isoDate.refine(notInFuture, 'Der Beginn darf nicht in der Zukunft liegen').optional(),
    location: z.string().trim().max(200).optional(),
  })
  .strict()

export const qcEntrySchema = z
  .object({
    kind: z.enum(QC_ENTRY_KINDS),
    text: z.string().trim().min(1, 'Bitte etwas eintragen').max(5000),
    occurredAt: isoDate.refine(notInFuture, 'Der Zeitpunkt darf nicht in der Zukunft liegen').optional(),
    /** Korrigiert einen früheren Eintrag derselben Kontrolle. */
    correctsId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()

export const qcCompleteSchema = z
  .object({
    rating: z.enum(QC_RATINGS),
    grade: gradeSchema.nullable().optional(),
    summary: z.string().trim().min(1, 'Bitte ein Fazit schreiben').max(20000),
    endedAt: isoDate.refine(notInFuture, 'Das Ende darf nicht in der Zukunft liegen').optional(),
    location: z.string().trim().max(200).optional(),
  })
  .strict()

/** Note einer laufenden Kontrolle setzen oder zurücknehmen (`null`). */
export const qcGradeSchema = z.object({ grade: gradeSchema.nullable() }).strict()

export const qcShareSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    scope: z.enum(QC_SHARE_SCOPES),
    checkId: z.string().trim().min(1).max(191).nullable().default(null),
    lspdOfficerId: z.string().trim().min(1).max(191).nullable().default(null),
    includeCareer: z.boolean().default(false),
    enabled: z.boolean().default(true),
    expiresAt: isoDate.nullable().default(null),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.scope === 'CHECK' && !input.checkId) ctx.addIssue({ code: 'custom', message: 'Bitte die Kontrolle wählen', path: ['checkId'] })
    if (input.scope === 'OFFICER' && !input.lspdOfficerId) ctx.addIssue({ code: 'custom', message: 'Bitte den Beamten wählen', path: ['lspdOfficerId'] })
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'Das Ablaufdatum muss in der Zukunft liegen', path: ['expiresAt'] })
    }
  })

export const qcShareUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    expiresAt: isoDate.nullable().optional(),
    includeCareer: z.boolean().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    /** Neuen geheimen Link erzeugen; der alte wird ungültig. */
    rotate: z.literal(true).optional(),
  })
  .strict()

export interface QcEntryLike {
  id: string
  kind: string
  correctsId: string | null
}

/** IDs der Einträge, die durch einen späteren Eintrag korrigiert wurden. */
export function correctedEntryIds(entries: readonly QcEntryLike[]) {
  return new Set(entries.map((entry) => entry.correctsId).filter((id): id is string => Boolean(id)))
}

export interface QcBalance {
  positive: number
  negative: number
  notes: number
}

/** Bilanz einer Kontrolle – korrigierte Einträge zählen nicht mehr, ihre Korrektur schon. */
export function entryBalance(entries: readonly QcEntryLike[]): QcBalance {
  const corrected = correctedEntryIds(entries)
  const balance: QcBalance = { positive: 0, negative: 0, notes: 0 }
  for (const entry of entries) {
    if (corrected.has(entry.id)) continue
    if (entry.kind === 'POSITIVE') balance.positive += 1
    else if (entry.kind === 'NEGATIVE') balance.negative += 1
    else balance.notes += 1
  }
  return balance
}

/** Vorschlag für die Gesamtbewertung – die Entscheidung trifft der Prüfer. */
export function suggestRating(balance: QcBalance): QcRating {
  if (balance.negative > balance.positive) return 'NEGATIVE'
  if (balance.positive > balance.negative) return 'POSITIVE'
  return 'NEUTRAL'
}

/**
 * Darf ein Eintrag als Korrektur auf `correctsId` verweisen? Nur auf einen
 * Eintrag derselben Kontrolle, der nicht schon korrigiert wurde – sonst
 * entstünden verzweigte Korrekturketten.
 */
export function correctionError(entries: readonly QcEntryLike[], correctsId: string | undefined) {
  if (!correctsId) return null
  if (!entries.some((entry) => entry.id === correctsId)) return 'Der korrigierte Eintrag gehört nicht zu dieser Kontrolle'
  if (correctedEntryIds(entries).has(correctsId)) return 'Dieser Eintrag wurde bereits korrigiert'
  return null
}

export interface QcShareLike {
  scope: string
  checkId: string | null
  lspdOfficerId: string | null
  enabled: boolean
  expiresAt: Date | null
}

export function qcShareIsActive(share: Pick<QcShareLike, 'enabled' | 'expiresAt'>, now = new Date()) {
  return share.enabled && (!share.expiresAt || share.expiresAt.getTime() > now.getTime())
}

/** Deckt die Freigabe diese Kontrolle bzw. diesen Beamten ab? */
export function qcShareCovers(share: QcShareLike, target: { checkId?: string; lspdOfficerId: string }) {
  if (share.scope === 'ALL') return true
  if (share.scope === 'OFFICER') return share.lspdOfficerId === target.lspdOfficerId
  if (share.scope === 'CHECK') return Boolean(target.checkId) && share.checkId === target.checkId
  return false
}

export interface QcOfficerStats {
  lspdOfficerId: string
  name: string
  badgeNumber: string
  rank: string
  total: number
  running: number
  ratings: Record<QcRating, number>
  lastCheckAt: string
}

export interface QcCheckRow {
  lspdOfficerId: string
  officerName: string
  officerBadge: string
  officerRank: string
  status: string
  rating: string | null
  startedAt: Date
}

/** Kennzahlen je Beamtem; Name/Rang aus der jüngsten Kontrolle. */
export function aggregateOfficerStats(rows: readonly QcCheckRow[]): QcOfficerStats[] {
  const byOfficer = new Map<string, QcOfficerStats>()
  const latest = new Map<string, number>()
  for (const row of rows) {
    const time = row.startedAt.getTime()
    let stats = byOfficer.get(row.lspdOfficerId)
    if (!stats) {
      stats = {
        lspdOfficerId: row.lspdOfficerId,
        name: row.officerName,
        badgeNumber: row.officerBadge,
        rank: row.officerRank,
        total: 0,
        running: 0,
        ratings: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 },
        lastCheckAt: row.startedAt.toISOString(),
      }
      byOfficer.set(row.lspdOfficerId, stats)
      latest.set(row.lspdOfficerId, time)
    }
    stats.total += 1
    if (row.status === 'RUNNING') stats.running += 1
    if (row.rating && row.rating in stats.ratings) stats.ratings[row.rating as QcRating] += 1
    if (time >= (latest.get(row.lspdOfficerId) ?? 0)) {
      latest.set(row.lspdOfficerId, time)
      stats.name = row.officerName
      stats.badgeNumber = row.officerBadge
      stats.rank = row.officerRank
      stats.lastCheckAt = row.startedAt.toISOString()
    }
  }
  return [...byOfficer.values()].sort((a, b) => b.lastCheckAt.localeCompare(a.lastCheckAt))
}

export interface QcDirectoryRow {
  id: string
  name: string
  badge: string
  rank: string
  rankColor: string
  /** Leer, wenn der Beamte im Panel gerade nicht gefunden wurde. */
  status: string
  terminated: boolean
  stats: QcOfficerStats | null
}

/**
 * Beamtenliste der Qualitätskontrollen: alle aktiven Beamten aus dem Panel,
 * Gekündigte nur, wenn es zu ihnen schon eine Kontrolle gibt. Kontrollierte,
 * die das Panel (gerade) nicht liefert, erscheinen mit ihrer Momentaufnahme.
 */
export function buildOfficerDirectory(input: {
  active: readonly LspdOfficer[] | null
  terminated: readonly LspdOfficer[] | null
  stats: readonly QcOfficerStats[]
  term: string
}): QcDirectoryRow[] {
  const statsById = new Map(input.stats.map((row) => [row.lspdOfficerId, row]))
  const rows: QcDirectoryRow[] = []
  const seen = new Set<string>()

  const fromPanel = (officer: LspdOfficer, terminated: boolean) => {
    seen.add(officer.id)
    rows.push({
      id: officer.id,
      name: lspdOfficerName(officer),
      badge: cleanLspdBadge(officer.badgeNumber),
      rank: officer.rank.name,
      rankColor: officer.rank.color,
      status: lspdStatusLabel(officer.status),
      terminated,
      stats: statsById.get(officer.id) ?? null,
    })
  }

  for (const officer of input.active ?? []) fromPanel(officer, false)
  for (const officer of input.terminated ?? []) {
    if (statsById.has(officer.id) && !seen.has(officer.id)) fromPanel(officer, true)
  }

  const term = input.term.trim().toLowerCase()
  for (const stats of input.stats) {
    if (seen.has(stats.lspdOfficerId)) continue
    const badge = cleanLspdBadge(stats.badgeNumber)
    if (term && !`${stats.name} ${badge}`.toLowerCase().includes(term)) continue
    rows.push({
      id: stats.lspdOfficerId,
      name: stats.name,
      badge,
      rank: stats.rank,
      rankColor: '#8e8e93',
      status: '',
      terminated: false,
      stats,
    })
  }
  return rows
}
