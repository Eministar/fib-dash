import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

/**
 * Verknüpft Dashboard-Accounts mit ihrer Personalakte über die Discord-ID.
 *
 * Die Zuständigkeitsprüfung des Sanktionskatalogs braucht den Rang der
 * handelnden Person; ohne Verknüpfung kann sie den Rang nicht ermitteln.
 * Ohne `--apply` läuft das Skript als Trockenlauf.
 */

function loadEnvironment() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
}

async function main() {
  loadEnvironment()
  const apply = process.argv.slice(2).includes('--apply')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })

  try {
    const users = await prisma.user.findMany({
      where: { discordId: { not: null } },
      select: { id: true, displayName: true, discordId: true },
    })

    const candidates: { userId: string; agentId: string; label: string }[] = []
    let alreadyLinked = 0
    let noMatch = 0

    for (const user of users) {
      if (!user.discordId) continue
      const agent = await prisma.agent.findUnique({
        where: { discordId: user.discordId },
        select: { id: true, firstName: true, lastName: true, badgeNumber: true, userId: true },
      })

      if (!agent) {
        noMatch += 1
        continue
      }
      if (agent.userId === user.id) {
        alreadyLinked += 1
        continue
      }
      // Fremd verknüpfte Akten werden nicht angefasst — das ist ein Fall für Menschen.
      if (agent.userId && agent.userId !== user.id) {
        console.warn(`Übersprungen: ${agent.firstName} ${agent.lastName} ist bereits einem anderen Account zugeordnet.`)
        continue
      }

      candidates.push({
        userId: user.id,
        agentId: agent.id,
        label: `${user.displayName} → ${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
      })
    }

    console.log(`Accounts mit Discord-ID: ${users.length}`)
    console.log(`Bereits verknüpft: ${alreadyLinked}`)
    console.log(`Ohne passende Personalakte: ${noMatch}`)
    console.log(`Neu zu verknüpfen: ${candidates.length}`)

    for (const candidate of candidates) console.log(`  ${candidate.label}`)

    if (!apply) {
      console.log('\nTrockenlauf. Mit --apply werden die Verknüpfungen geschrieben.')
      return
    }

    for (const candidate of candidates) {
      await prisma.agent.update({
        where: { id: candidate.agentId },
        data: { userId: candidate.userId },
      })
    }

    console.log(`\n${candidates.length} Verknüpfungen geschrieben.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Verknüpfung fehlgeschlagen.')
  process.exitCode = 1
})
