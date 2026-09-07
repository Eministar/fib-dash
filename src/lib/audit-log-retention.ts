import { prisma } from '@/lib/prisma'

const CLEANUP_SETTING_KEY = 'maintenance.auditLogs.lastCleanupDate'
const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_RETENTION_DAYS = 365
const MIN_RETENTION_DAYS = 30
const MAX_RETENTION_DAYS = 3_650
const CLEANUP_BATCH_SIZE = 1_000

let lastAttemptAt = 0
let inFlight: Promise<AuditLogCleanupResult> | null = null

export interface AuditLogCleanupResult {
  deleted: number
  retentionDays: number
  cutoff: string
  cleanupDate: string
  skipped: boolean
}

export function auditLogRetentionDays() {
  const raw = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10)
  if (!Number.isFinite(raw)) return DEFAULT_RETENTION_DAYS
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, raw))
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

/**
 * Löscht Audit-Protokolle älter als die Aufbewahrungsfrist höchstens einmal pro
 * Kalendertag. Der Marker in SystemSetting verhindert, dass mehrere App-Worker
 * die gleiche tägliche Bereinigung unnötig wiederholen.
 */
export async function runAuditLogCleanup(options?: { now?: Date; force?: boolean }) {
  if (inFlight) return inFlight

  const now = options?.now ?? new Date()
  const force = options?.force === true
  if (!force && Date.now() - lastAttemptAt < 15 * 60 * 1_000) {
    return {
      deleted: 0,
      retentionDays: auditLogRetentionDays(),
      cutoff: new Date(now.getTime() - auditLogRetentionDays() * DAY_MS).toISOString(),
      cleanupDate: dateKey(now),
      skipped: true,
    }
  }
  lastAttemptAt = Date.now()

  inFlight = (async () => {
    const retentionDays = auditLogRetentionDays()
    const cleanupDate = dateKey(now)
    const marker = await prisma.systemSetting.findUnique({
      where: { key: CLEANUP_SETTING_KEY },
      select: { value: true },
    })
    if (!force && marker?.value === cleanupDate) {
      return {
        deleted: 0,
        retentionDays,
        cutoff: new Date(now.getTime() - retentionDays * DAY_MS).toISOString(),
        cleanupDate,
        skipped: true,
      }
    }

    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
    let deleted = 0
    // In Batches löschen, damit eine große Altlast nicht minutenlang die
    // komplette AuditLog-Tabelle sperrt.
    while (true) {
      const candidates = await prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: CLEANUP_BATCH_SIZE,
      })
      if (candidates.length === 0) break
      const result = await prisma.auditLog.deleteMany({
        where: { id: { in: candidates.map((candidate) => candidate.id) } },
      })
      deleted += result.count
      if (candidates.length < CLEANUP_BATCH_SIZE) break
    }
    try {
      await prisma.systemSetting.upsert({
        where: { key: CLEANUP_SETTING_KEY },
        update: { value: cleanupDate },
        create: { key: CLEANUP_SETTING_KEY, value: cleanupDate },
      })
    } catch (error) {
      // Zwei Worker können am Tageswechsel gleichzeitig starten. Wenn beide
      // den Marker anlegen wollen, ist der Unique-Konflikt erwartbar; die
      // Bereinigung selbst wurde bereits erfolgreich ausgeführt.
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error
    }

    return {
      deleted,
      retentionDays,
      cutoff: cutoff.toISOString(),
      cleanupDate,
      skipped: false,
    }
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
