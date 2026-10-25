import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

import { DEFAULT_LICENSES } from '../src/lib/licenses/default-licenses'

/**
 * Legt die Lizenzarten aus dem Konzept „Lizenzen Intern“ an – ohne den vollen Seed,
 * der auch Benutzergruppen zurücksetzt. Vorhandene Lizenzen bleiben unangetastet.
 */
async function main() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
  try {
    let created = 0
    for (const [index, license] of DEFAULT_LICENSES.entries()) {
      if (await prisma.license.findUnique({ where: { key: license.key } })) continue
      await prisma.license.create({ data: { ...license, sortOrder: index + 1 } })
      created++
    }
    console.log(`Lizenzen: ${created} angelegt, ${DEFAULT_LICENSES.length - created} schon vorhanden.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
