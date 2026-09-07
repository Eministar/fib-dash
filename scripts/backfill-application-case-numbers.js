/* eslint-disable @typescript-eslint/no-require-imports */

require('dotenv/config')

/**
 * Vergibt Aktenzeichen ("BW-0001") an Bewerbungen, die aus der Zeit vor dieser
 * Funktion stammen — in Reihenfolge des Eingangs. Der Anzeigename des Bewerbers
 * wird dabei auf "BW-0001 | Vorname Nachname" umgestellt.
 *
 * Idempotent: Bewerbungen mit Aktenzeichen werden übersprungen. Discord-Nicknames
 * werden hier bewusst NICHT angefasst — das bleibt dem laufenden Betrieb
 * überlassen, damit ein Wartungsskript keine Massenänderung im Server auslöst.
 */

const CASE_PREFIX = 'BW-'
const CASE_PATTERN = /^BW-(\d{1,10})$/i
const CASE_PREFIX_IN_NAME = /^\s*BW-\d{1,10}\s*\|\s*/i

function createPrisma() {
  const { PrismaClient } = require('../src/generated/prisma/client')
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt oder ist leer.')
  return new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
}

function formatCaseNumber(value) {
  return `${CASE_PREFIX}${String(value).padStart(4, '0')}`
}

function parseCaseNumber(value) {
  const match = CASE_PATTERN.exec(String(value || '').trim())
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function buildDisplayName(caseNumber, name) {
  const cleanName = String(name || '').replace(CASE_PREFIX_IN_NAME, '').replace(/\s+/g, ' ').trim()
  return cleanName ? `${caseNumber} | ${cleanName}` : caseNumber
}

async function backfillApplicationCaseNumbers(prisma) {
  const applications = await prisma.jobApplication.findMany({
    select: { id: true, caseNumber: true, applicantId: true, applicantDisplayName: true },
    orderBy: { submittedAt: 'asc' },
  })

  let next = applications.reduce(
    (max, row) => Math.max(max, parseCaseNumber(row.caseNumber) || 0),
    0,
  ) + 1

  let assigned = 0
  for (const application of applications) {
    if (parseCaseNumber(application.caseNumber)) continue

    const caseNumber = formatCaseNumber(next)
    next += 1
    const displayName = buildDisplayName(caseNumber, application.applicantDisplayName)

    await prisma.$transaction([
      prisma.jobApplication.update({
        where: { id: application.id },
        data: { caseNumber, applicantDisplayName: displayName },
      }),
      prisma.user.update({
        where: { id: application.applicantId },
        data: { displayName },
      }),
    ])
    assigned += 1
  }

  return { assigned, total: applications.length }
}

async function main() {
  const prisma = createPrisma()
  try {
    const result = await backfillApplicationCaseNumbers(prisma)
    console.log(`[DB] Aktenzeichen vergeben: ${result.assigned} von ${result.total} Bewerbungen.`)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[DB] Aktenzeichen-Vergabe fehlgeschlagen:', error)
    process.exit(1)
  })
}

module.exports = { backfillApplicationCaseNumbers }
