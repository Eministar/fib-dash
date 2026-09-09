import fs from 'node:fs/promises'
import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

import {
  SANCTION_AUTHORITIES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
} from '../src/lib/sanction-catalog'

/**
 * Legt den Sanktionskatalog v1.0 an:
 *
 * 1. die Zuständigkeiten je Sanktionsstufe (`SanctionLevelAuthority`), und
 * 2. den Leitfaden als editierbare Ordnung mit dem Inhalt aus
 *    `sanktionskatalog.md`.
 *
 * Ohne `--force` bleibt ein bereits angepasster Ordnungs-Text unangetastet;
 * die Zuständigkeiten werden nie überschrieben, nur ergänzt.
 */

const ORDNUNG_SLUG = 'sanktionskatalog'
const CATEGORY_KEY = 'dienstvorschriften'

function loadEnvironment() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
}

async function main() {
  loadEnvironment()
  const force = process.argv.slice(2).includes('--force')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const content = await fs.readFile(path.join(process.cwd(), 'sanktionskatalog.md'), 'utf8')
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })

  try {
    // --- Zuständigkeiten je Stufe ---------------------------------------
    let createdAuthorities = 0
    for (const level of SANCTION_LEVEL_ORDER) {
      const fallback = SANCTION_AUTHORITIES[SANCTION_LEVELS[level].authority]
      const existing = await prisma.sanctionLevelAuthority.findUnique({ where: { level } })
      if (existing && !force) continue

      await prisma.sanctionLevelAuthority.upsert({
        where: { level },
        update: force
          ? { authorityLabel: fallback.label, minRankSortOrder: fallback.defaultMinRankSortOrder }
          : {},
        create: {
          level,
          authorityLabel: fallback.label,
          minRankSortOrder: fallback.defaultMinRankSortOrder,
        },
      })
      createdAuthorities += 1
    }
    console.log(`Zuständigkeiten: ${createdAuthorities} von ${SANCTION_LEVEL_ORDER.length} Stufen geschrieben.`)

    // --- Ordnung ---------------------------------------------------------
    const category = await prisma.ordnungCategory.upsert({
      where: { key: CATEGORY_KEY },
      update: {},
      create: {
        key: CATEGORY_KEY,
        label: 'Dienstvorschriften',
        description: 'Interne Dienststandards des Federal Investigation Bureau.',
        icon: 'Scale',
        color: '#f59e0b',
        sortOrder: 0,
      },
    })

    const existing = await prisma.ordnung.findUnique({ where: { slug: ORDNUNG_SLUG } })

    if (existing && !force) {
      console.log('Ordnung "Sanktionskatalog" existiert bereits — Inhalt bleibt unverändert (--force zum Überschreiben).')
      return
    }

    await prisma.ordnung.upsert({
      where: { slug: ORDNUNG_SLUG },
      update: { content, categoryId: category.id },
      create: {
        slug: ORDNUNG_SLUG,
        title: 'Sanktionskatalog',
        description: 'Einstufung, Sanktionierung und Dokumentation von Fehlverhalten — Version 1.0.',
        buttonLabel: 'Katalog öffnen',
        icon: 'Scale',
        content,
        categoryId: category.id,
        sortOrder: 0,
      },
    })

    console.log(existing
      ? 'Ordnung "Sanktionskatalog" überschrieben.'
      : 'Ordnung "Sanktionskatalog" angelegt.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed fehlgeschlagen.')
  process.exitCode = 1
})
