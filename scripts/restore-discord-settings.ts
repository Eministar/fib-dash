import fs from 'node:fs/promises'
import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

type BackupSetting = {
  key: string
  value: string
}

type DatabaseBackup = {
  meta?: {
    exportedAt?: string
    formatVersion?: number
  }
  data?: {
    systemSettings?: unknown
  }
}

function loadEnvironment() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
}

function discordSettingsFromBackup(value: DatabaseBackup): BackupSetting[] {
  const rows = value.data?.systemSettings
  if (!Array.isArray(rows)) throw new Error('Das Backup enthält keine systemSettings-Liste.')

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const candidate = row as { key?: unknown; value?: unknown }
    if (
      typeof candidate.key !== 'string'
      || !candidate.key.startsWith('discord.')
      || typeof candidate.value !== 'string'
    ) return []
    return [{ key: candidate.key, value: candidate.value }]
  })
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const backupArg = args.find((arg) => !arg.startsWith('--'))
  if (!backupArg) {
    throw new Error('Backup-Datei fehlt. Beispiel: npm run db:restore-discord-settings -- /pfad/db-backup.json')
  }

  const backupPath = path.resolve(backupArg)
  const parsed = JSON.parse(await fs.readFile(backupPath, 'utf8')) as DatabaseBackup
  const rows = discordSettingsFromBackup(parsed)
  if (rows.length === 0) throw new Error('Im Backup wurden keine discord.*-Einstellungen gefunden.')

  console.log(`Backup: ${path.basename(backupPath)}`)
  console.log(`Stand: ${parsed.meta?.exportedAt || 'unbekannt'}`)
  console.log(`Gefundene Discord-Einstellungen: ${rows.length}`)
  console.log(rows.map((row) => `- ${row.key}`).sort().join('\n'))

  if (!apply) {
    console.log('\nNur geprüft – keine Datenbank wurde verändert.')
    console.log('Zum Wiederherstellen denselben Befehl mit --apply ausführen.')
    return
  }

  loadEnvironment()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
  try {
    const currentRows = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'discord.' } },
      orderBy: { key: 'asc' },
    })
    const rollbackDir = path.join(process.cwd(), '.backup')
    const rollbackPath = path.join(rollbackDir, `discord-settings-before-restore-${safeTimestamp()}.json`)
    await fs.mkdir(rollbackDir, { recursive: true })
    await fs.writeFile(rollbackPath, JSON.stringify({
      meta: { exportedAt: new Date().toISOString(), source: 'before-discord-settings-restore' },
      data: { systemSettings: currentRows },
    }, null, 2), { encoding: 'utf8', mode: 0o600 })

    await prisma.$transaction(rows.map((row) => prisma.systemSetting.upsert({
      where: { key: row.key },
      create: row,
      update: { value: row.value },
    })))

    console.log(`\n${rows.length} Discord-Einstellungen wurden wiederhergestellt.`)
    console.log(`Rücksetzpunkt: ${rollbackPath}`)
    console.log('Die App jetzt neu starten und die Discord-Einstellungen prüfen.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Wiederherstellung fehlgeschlagen.')
  process.exitCode = 1
})
