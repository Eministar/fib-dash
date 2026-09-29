import 'dotenv/config'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { createDatabaseBackup } from '../src/lib/database-backup'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL fehlt – Backup nicht möglich.')
    process.exit(1)
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) })
  try {
    const result = await createDatabaseBackup(prisma, path.join(process.cwd(), '.backup'))
    console.log('Backup geschrieben:', result.file)
    console.log('Aktuelle Kopie:', result.latest)
    console.log(`Tabellen: ${Object.keys(result.counts).length} · Dauer: ${Math.round(result.durationMs / 1000)} s`)
    console.log('Zeilen:', result.counts)
    if (result.failed.length > 0) {
      // Teil-Backup ist besser als keins, aber nicht still als Erfolg melden.
      console.error('Nicht vollständig gesichert:', result.failed.join(', '))
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
