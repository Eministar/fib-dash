/* eslint-disable @typescript-eslint/no-require-imports */

require('dotenv/config')

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectDir = path.resolve(__dirname, '..')
const prismaCli = path.join(projectDir, 'node_modules', 'prisma', 'build', 'index.js')
const importFile = path.join(projectDir, 'prisma', 'initial-import-2026-06-19.sql')
const importMarkerKey = 'database.initialImport.2026-06-19'
const expectedImportCounts = {
  ranks: 16,
  agents: 38,
  dutySessions: 38,
  promotionLogs: 58,
  sanctions: 3,
}
const { normalizeBadgeNumbers } = require('./normalize-badge-numbers')
const { backfillApplicationCaseNumbers } = require('./backfill-application-case-numbers')

function runPrisma(args, label) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: projectDir,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error(`${label} konnte nicht gestartet werden: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${label} ist mit Exit-Code ${result.status} fehlgeschlagen.`)
  }
}

/**
 * Hängt Daten der entfernten Module (Internal Affairs / früher Detective) verlustfrei
 * um, BEVOR `db push` die zugehörigen Enum-Werte droppt. Andernfalls bricht der Push
 * mit "data loss"/"variant still used" ab, weil noch Zeilen die Werte referenzieren.
 *
 * `prisma db push` verlangt zum ENTFERNEN von Enum-Werten zwingend `--accept-data-loss`
 * (pauschal, auch wenn kein Datensatz die Werte nutzt). Statt das Flag global zu
 * setzen, führen wir die Enum-Verengung hier selbst aus: erst Daten umhängen, dann
 * per ALTER die alten Werte entfernen. Danach sieht `db push` keinen Unterschied mehr
 * und läuft ohne Flag durch — alle anderen destruktiven Änderungen bleiben geschützt.
 *
 * Idempotent: Nach dem ersten Lauf matchen die UPDATEs nichts mehr und die ALTERs sind
 * No-Ops; auf einer frischen DB (Tabellen noch nicht vorhanden) werden Fehler bewusst
 * ignoriert (db push legt die Tabellen dann korrekt an).
 */
async function reassignRemovedDepartmentEnums(prisma) {
  const statements = [
    // 1) Daten der entfernten Module verlustfrei umhängen.
    "UPDATE `TaskList` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE')",
    "UPDATE `SruFolder` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE')",
    "UPDATE `SruDocument` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE')",
    "UPDATE `CalendarEvent` SET `module` = NULL WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE')",
    "UPDATE `CalendarEvent` SET `type` = 'OTHER' WHERE `type` IN ('INTERNAL_AFFAIRS_BRIEFING', 'INTERNAL_AFFAIRS_CASE', 'DETECTIVE_BRIEFING', 'DETECTIVE_CASE')",
    "DELETE FROM `Unit` WHERE `key` = 'INTERNAL_AFFAIRS'",
    // 2) Enum-Werte entfernen, damit db push keine "data loss"-Warnung mehr wirft.
    "ALTER TABLE `TaskList` MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL",
    "ALTER TABLE `SruFolder` MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL DEFAULT 'SRU'",
    "ALTER TABLE `SruDocument` MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL DEFAULT 'SRU'",
    "ALTER TABLE `CalendarEvent` MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NULL, MODIFY `type` ENUM('TRAINING', 'MEETING', 'ACADEMY', 'EXAM', 'HR_DEADLINE', 'SRU_TRAINING', 'SRU_OPERATION', 'AIR_SUPPORT_TRAINING', 'AIR_SUPPORT_OPERATION', 'OTHER') NOT NULL DEFAULT 'OTHER'",
  ]
  let changed = false
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql)
      changed = true
    } catch (e) {
      // Tabelle existiert noch nicht (frische DB) → für db push irrelevant.
      console.warn(`[DB] Enum-Reassign übersprungen: ${(e && e.message ? e.message.split('\n')[0] : e)}`)
    }
  }
  if (changed) {
    console.log('[DB] Internal-Affairs/Detective-Daten umgehängt und Enum-Werte entfernt.')
  }
}

function loadPrisma() {
  const { PrismaClient } = require('../src/generated/prisma/client')
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
  const databaseUrl = String(process.env.DATABASE_URL || '').trim()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL fehlt oder ist leer.')
  }

  return new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
}

async function main() {
  if (!fs.existsSync(prismaCli)) {
    throw new Error(`Prisma CLI wurde nicht gefunden: ${prismaCli}`)
  }

  // Vor dem Schema-Sync: Daten entfernter Module umhängen, damit `db push` die
  // Enum-Werte gefahrlos droppen kann (sonst Abbruch wegen "data loss").
  const migrationPrisma = loadPrisma()
  try {
    await reassignRemovedDepartmentEnums(migrationPrisma)
  } finally {
    await migrationPrisma.$disconnect()
  }

  console.log('[DB] Schema wird sicher synchronisiert.')
  runPrisma(['db', 'push'], 'prisma db push')

  const prisma = loadPrisma()
  try {
    // Vor allen weiteren Zweigen: Bewerbungen ohne Aktenzeichen nachziehen.
    const caseNumbers = await backfillApplicationCaseNumbers(prisma)
    if (caseNumbers.assigned > 0) {
      console.log(`[DB] Aktenzeichen vergeben: ${caseNumbers.assigned} von ${caseNumbers.total} Bewerbungen.`)
    }

    const marker = await prisma.systemSetting.findUnique({
      where: { key: importMarkerKey },
    })

    if (marker) {
      const normalized = await normalizeBadgeNumbers(prisma)
      console.log(`[DB] Dienstnummern normalisiert: ${normalized.agents} Agents, ${normalized.blacklist} Blacklist-Einträge.`)
      console.log('[DB] Initialimport wurde bereits verarbeitet.')
      return
    }

    const [rankCount, agentCount, userCount] = await Promise.all([
      prisma.rank.count(),
      prisma.agent.count(),
      prisma.user.count(),
    ])

    if (rankCount > 0 || agentCount > 0 || userCount > 0) {
      const normalized = await normalizeBadgeNumbers(prisma)
      console.log(`[DB] Dienstnummern normalisiert: ${normalized.agents} Agents, ${normalized.blacklist} Blacklist-Einträge.`)
      await prisma.systemSetting.create({
        data: {
          key: importMarkerKey,
          value: JSON.stringify({
            status: 'skipped-existing-database',
            processedAt: new Date().toISOString(),
          }),
        },
      })
      console.log('[DB] Bestehende Daten erkannt; Initialimport wird dauerhaft übersprungen.')
      return
    }

    if (!fs.existsSync(importFile)) {
      throw new Error(`Initialimport fehlt: ${importFile}`)
    }

    console.log('[DB] Leere Datenbank erkannt; Initialimport wird einmalig ausgeführt.')
    runPrisma(['db', 'execute', '--file', importFile], 'Initialimport')

    const importedCounts = {
      ranks: await prisma.rank.count({
        where: { id: { startsWith: 'rank_' } },
      }),
      agents: await prisma.agent.count({
        where: { id: { startsWith: 'agent_' } },
      }),
      dutySessions: await prisma.dutyTimeSession.count({
        where: { id: { startsWith: 'duty_import_' } },
      }),
      promotionLogs: await prisma.promotionLog.count({
        where: { id: { startsWith: 'promo_import_' } },
      }),
      sanctions: await prisma.sanction.count({
        where: { id: { startsWith: 'sanction_import_' } },
      }),
    }

    const incompleteEntries = Object.entries(expectedImportCounts)
      .filter(([key, expected]) => importedCounts[key] !== expected)
      .map(([key, expected]) => `${key}: ${importedCounts[key]}/${expected}`)

    if (incompleteEntries.length > 0) {
      throw new Error(`Initialimport ist unvollständig: ${incompleteEntries.join(', ')}`)
    }

    const normalized = await normalizeBadgeNumbers(prisma)
    console.log(`[DB] Dienstnummern normalisiert: ${normalized.agents} Agents, ${normalized.blacklist} Blacklist-Einträge.`)

    await prisma.systemSetting.create({
      data: {
        key: importMarkerKey,
        value: JSON.stringify({
          status: 'imported',
          file: path.basename(importFile),
          counts: importedCounts,
          processedAt: new Date().toISOString(),
        }),
      },
    })
    console.log('[DB] Initialimport erfolgreich abgeschlossen und markiert.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[DB] Initialisierung fehlgeschlagen:', error)
  process.exit(1)
})
