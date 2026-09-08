import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { createCodenameSchema } from '../src/lib/codename-validation'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt')
  const raw: unknown = JSON.parse(await readFile(new URL('./data/codenames.json', import.meta.url), 'utf8'))
  const data = createCodenameSchema.array().min(1).parse(raw)
  const names = new Set(data.map(entry => entry.name.toLocaleLowerCase('en')))
  if (names.size !== data.length) throw new Error('Die Vorschlagsliste enthält doppelte Namen')
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) })
  try {
    const result = await prisma.codename.createMany({ data, skipDuplicates: true })
    await prisma.systemSetting.upsert({ where: { key: 'codenames.prefix' }, create: { key: 'codenames.prefix', value: 'Agent' }, update: {} })
    console.log(`${result.count} Decknamen angelegt; ${data.length - result.count} vorhandene Namen unverändert.`)
  } finally { await prisma.$disconnect() }
}

main().catch(cause => { console.error(cause); process.exitCode = 1 })
