import fs from 'node:fs/promises'
import path from 'node:path'
// Relative Imports: das Modul wird auch von `prisma/backup.ts` außerhalb von Next geladen.
import type { PrismaClient } from '../generated/prisma'

/** Rotierte Zeitstempel-Backups; latest.json liegt immer zusätzlich daneben. */
const MAX_TIMESTAMPED_FILES = 40
const PAGE_SIZE = 2_000

/**
 * Schlüssel des alten Formats (v1) bleiben erhalten, damit bestehende
 * Wiederherstellungs-Skripte (z. B. `data.systemSettings`) weiter funktionieren.
 */
const LEGACY_KEYS: Record<string, string> = {
  UserGroup: 'userGroups', User: 'users', Unit: 'units', Rank: 'ranks', Training: 'trainings',
  Agent: 'agents', AgentTraining: 'agentTrainings', DutyTimeSession: 'dutyTimeSessions',
  PlaytimeSession: 'playtimeSessions', AbsenceNotice: 'absenceNotices', PromotionLog: 'promotionLogs',
  Termination: 'terminations', Note: 'notes', AuditLog: 'auditLogs', ChangeSet: 'changeSets',
  ChangeSetSnapshot: 'changeSetSnapshots', ChangeSetTarget: 'changeSetTargets', ChangeSetEntry: 'changeSetEntries',
  RankChangeList: 'rankChangeLists', RankChangeListEntry: 'rankChangeListEntries', RankChangeVote: 'rankChangeVotes',
  RankChangeEntryComment: 'rankChangeEntryComments', RankChangeEntryProposal: 'rankChangeEntryProposals',
  RankChangeEntryHistory: 'rankChangeEntryHistory', SystemSetting: 'systemSettings', TaskList: 'taskLists',
  Task: 'tasks', TaskAssignment: 'taskAssignments', BadgeBlacklist: 'badgeBlacklists',
}
// MySQL kann Tabellennamen je nach Plattform kleinschreiben.
const LEGACY_KEYS_BY_TABLE = new Map(Object.entries(LEGACY_KEYS).map(([table, key]) => [table.toLowerCase(), key]))

export type BackupResult = {
  file: string
  latest: string
  counts: Record<string, number>
  failed: string[]
  durationMs: number
}

/** BigInt und Bytes sind nicht JSON-fähig – als String bzw. Base64 sichern. */
function replacer(_key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') }
  return value
}

function quoteIdentifier(name: string) {
  return `\`${name.replace(/`/g, '``')}\``
}

/** Alle echten Tabellen der Datenbank – inkl. impliziter n:m-Tabellen (`_AToB`), die keine Prisma-Modelle sind. */
async function listTables(prisma: PrismaClient) {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  )
  return rows.map((row) => String(row.name)).filter((name) => name !== '_prisma_migrations')
}

async function* readTable(prisma: PrismaClient, table: string) {
  const keys = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
    table,
  )
  if (keys.length === 0) {
    // Ohne Primärschlüssel (n:m-Tabellen) ist Paging nicht stabil – diese Tabellen sind klein.
    yield await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM ${quoteIdentifier(table)}`)
    return
  }
  // Seitenweise lesen: große Tabellen (Protokolle, Spielzeit) sprengen sonst den Speicher.
  const orderBy = keys.map((key) => quoteIdentifier(String(key.name))).join(', ')
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    )
    if (rows.length > 0) yield rows
    if (rows.length < PAGE_SIZE) return
  }
}

async function pruneOldBackups(dir: string) {
  const dated = (await fs.readdir(dir)).filter((name) => /^db-.*\.json$/.test(name)).sort()
  for (const name of dated.slice(0, Math.max(0, dated.length - MAX_TIMESTAMPED_FILES))) {
    await fs.unlink(path.join(dir, name)).catch(() => {})
  }
}

/**
 * Sichert ALLE Tabellen der Datenbank (Liste kommt aus information_schema,
 * neue Tabellen sind damit automatisch enthalten). Eine einzelne defekte Tabelle
 * bricht das Backup nicht ab, sondern wird unter `meta.failedTables` vermerkt.
 */
export async function createDatabaseBackup(prisma: PrismaClient, dir = path.join(process.cwd(), '.backup')): Promise<BackupResult> {
  const started = Date.now()
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `db-${stamp}.json`)
  const temp = `${file}.partial`
  const counts: Record<string, number> = {}
  const failed: string[] = []

  const handle = await fs.open(temp, 'w', 0o600)
  try {
    await handle.write(`{\n"data": {`)
    let firstTable = true
    const writeTable = async (key: string, pages: AsyncIterable<unknown[]>) => {
      await handle.write(`${firstTable ? '' : ','}\n${JSON.stringify(key)}: [`)
      firstTable = false
      let count = 0
      try {
        for await (const rows of pages) {
          for (const row of rows) {
            await handle.write(`${count === 0 ? '' : ','}\n${JSON.stringify(row, replacer)}`)
            count++
          }
        }
      } catch (error) {
        failed.push(key)
        console.error(`[Backup] Tabelle ${key} konnte nicht vollständig gelesen werden:`, error instanceof Error ? error.message : error)
      }
      await handle.write('\n]')
      counts[key] = count
    }

    for (const table of await listTables(prisma)) {
      await writeTable(LEGACY_KEYS_BY_TABLE.get(table.toLowerCase()) ?? table, readTable(prisma, table))
    }

    const meta = {
      exportedAt: new Date().toISOString(),
      formatVersion: 2,
      tables: Object.keys(counts).length,
      failedTables: failed,
      note: 'JSON-Snapshot aller Tabellen inkl. n:m-Verknüpfungen. Rohdaten je Tabelle (Tabellenname bzw. alter v1-Schlüssel). BigInt als String, Bytes als {$bytes: base64}. Bei Restore die FK-Reihenfolge beachten.',
    }
    await handle.write(`\n},\n"meta": ${JSON.stringify(meta, null, 2)}\n}\n`)
  } catch (error) {
    await handle.close()
    await fs.unlink(temp).catch(() => {})
    throw error
  }
  await handle.close()

  // Erst nach vollständigem Schreiben sichtbar machen – nie ein halbes latest.json.
  await fs.rename(temp, file)
  const latest = path.join(dir, 'latest.json')
  await fs.copyFile(file, `${latest}.partial`)
  await fs.rename(`${latest}.partial`, latest)
  await pruneOldBackups(dir)
  return { file, latest, counts, failed, durationMs: Date.now() - started }
}

let schedulerStarted = false
let running = false

/** Regelmäßige Backups im laufenden Server, nicht nur beim Deployment. */
export function ensureDatabaseBackupScheduler(prisma: PrismaClient) {
  const hours = Number.parseFloat(process.env.DATABASE_BACKUP_INTERVAL_HOURS ?? '6')
  if (schedulerStarted || !Number.isFinite(hours) || hours <= 0) return
  schedulerStarted = true
  const run = async () => {
    if (running) return
    running = true
    try {
      const result = await createDatabaseBackup(prisma)
      const rows = Object.values(result.counts).reduce((sum, value) => sum + value, 0)
      console.log(`[Backup] ${path.basename(result.file)}: ${rows} Zeilen aus ${Object.keys(result.counts).length} Tabellen in ${Math.round(result.durationMs / 1000)} s${result.failed.length ? ` · Fehler: ${result.failed.join(', ')}` : ''}`)
    } catch (error) {
      console.error('[Backup] Automatisches Backup fehlgeschlagen:', error)
    } finally {
      running = false
    }
  }
  // Kurz nach dem Start ein erstes Backup, danach im festen Intervall.
  setTimeout(() => void run(), 2 * 60_000).unref?.()
  setInterval(() => void run(), hours * 60 * 60_000).unref?.()
}
