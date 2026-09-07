import 'dotenv/config'

import { prisma } from '@/lib/prisma'

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      discordId: true,
      passwordHash: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const withPassword = users.filter((user) => Boolean(user.passwordHash))
  const withoutDiscordId = users.filter((user) => !user.discordId)

  if (withPassword.length > 0) {
    await prisma.user.updateMany({
      where: { passwordHash: { not: null } },
      data: { passwordHash: null },
    })
  }

  console.log(`Discord-only Migration abgeschlossen.`)
  console.log(`Umgestellte User: ${withPassword.length}`)
  console.log(`User ohne Discord-ID: ${withoutDiscordId.length}`)
  if (withoutDiscordId.length > 0) {
    console.log('Diese User können sich erst anmelden, wenn sie per Discord-ID zugeordnet sind:')
    for (const user of withoutDiscordId) {
      console.log(`- ${user.displayName} (@${user.username})`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
