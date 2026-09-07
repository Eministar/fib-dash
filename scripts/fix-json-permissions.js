/* eslint-disable @typescript-eslint/no-require-imports */

/*
 * Repariert Json-Spalten, die als leerer String ('') oder ungültiges JSON in
 * der DB liegen. Ursache für `prisma:error Unexpected end of JSON input`:
 * Prisma parst die Spalte beim Deserialisieren (JSON.parse('') wirft), bevor
 * Anwendungscode läuft — daher lässt sich das nur in den Daten beheben.
 *
 * Betroffene, im Auth-Pfad gelesene Spalten:
 *   UserGroup.permissions (Json, non-null)  -> '[]'
 *   User.permissions       (Json?, nullable) -> '[]' nur bei '', NULL bleibt
 *   Unit.permissions       (Json, non-null)  -> '[]'
 *   ApiToken.scopes        (Json, non-null)  -> '[]'
 *
 * Nutzung (auf dem Server, wo die DB erreichbar ist):
 *   node scripts/fix-json-permissions.js            # Dry-Run: nur anzeigen
 *   node scripts/fix-json-permissions.js --apply    # tatsächlich reparieren
 */

require('dotenv/config')

function createPrisma() {
  const { PrismaClient } = require('../src/generated/prisma/client')
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt oder ist leer.')
  return new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
}

// [Tabelle, Spalte] — Reparatur trifft nur '' oder ungültiges JSON; echte NULL
// bleibt unangetastet (Prisma verarbeitet NULL problemlos).
const TARGETS = [
  ['UserGroup', 'permissions'],
  ['User', 'permissions'],
  ['Unit', 'permissions'],
  ['ApiToken', 'scopes'],
]

function badRowsWhere(col) {
  return `\`${col}\` = '' OR (\`${col}\` IS NOT NULL AND JSON_VALID(\`${col}\`) = 0)`
}

async function fixJsonPermissions(prisma, { apply }) {
  let totalBad = 0
  let totalFixed = 0

  for (const [table, col] of TARGETS) {
    // WICHTIG: Spalte als CHAR casten. Der mariadb-Adapter meldet die Spalte
    // sonst als JSON-Typ, und Prisma ruft beim Deserialisieren JSON.parse('')
    // auf → genau der Crash, den wir reparieren wollen. CAST liefert einen
    // String und umgeht das Parsen.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, CAST(\`${col}\` AS CHAR) AS v FROM \`${table}\` WHERE ${badRowsWhere(col)}`,
    )
    if (rows.length === 0) {
      console.log(`[ok]  ${table}.${col}: sauber`)
      continue
    }
    totalBad += rows.length
    console.log(`[BAD] ${table}.${col}: ${rows.length} Zeile(n)`)
    for (const row of rows) console.log(`   id=${row.id}  value=${JSON.stringify(row.v)}`)

    if (apply) {
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE \`${table}\` SET \`${col}\` = '[]' WHERE ${badRowsWhere(col)}`,
      )
      totalFixed += updated
      console.log(`   -> ${updated} Zeile(n) auf '[]' gesetzt`)
    }
  }

  return { totalBad, totalFixed }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const prisma = createPrisma()
  try {
    const { totalBad, totalFixed } = await fixJsonPermissions(prisma, { apply })
    if (totalBad === 0) {
      console.log('[DB] Keine defekten Json-Spalten gefunden.')
    } else if (apply) {
      console.log(`[DB] Fertig: ${totalFixed} Zeile(n) repariert.`)
    } else {
      console.log(`[DB] Dry-Run: ${totalBad} Zeile(n) würden repariert. Mit --apply ausführen.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[DB] Json-Reparatur fehlgeschlagen:', error)
    process.exit(1)
  })
}

module.exports = { fixJsonPermissions }
