import path from 'node:path'

import dotenv from 'dotenv'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient, Prisma } from '../src/generated/prisma/client'
import {
  migratedSummary,
  planDossierMigration,
  planShareItemRewrites,
  type MigratedRecord,
} from '../src/lib/dossier-migration'
import { formatSequenceNumber, parseSequenceNumber } from '../src/lib/sequence-numbers'
import { INVESTIGATION_CASE_PREFIX } from '../src/lib/investigations'

/**
 * Wandelt alle Unterakten (`Dossier.kind = 'FILE'`) in Einsatzakten um.
 *
 * Unterakte und Einsatzakte beschrieben dasselbe – einen Einsatz, der zu einer
 * Dauerakte gehört – lagen aber in zwei Tabellen und in zwei Reitern. Nach
 * diesem Lauf gibt es nur noch die Einsatzakte.
 *
 * Ohne `--apply` ein Trockenlauf: der Report wird ausgegeben, geschrieben wird
 * nichts. Der Schreiblauf ist unumkehrbar, deshalb vorher `npm run db:backup`.
 */

function loadEnvironment() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
}

type Report = {
  caseNumber: string
  dossierId: string
  investigationId: string
  title: string
  anchorId: string | null
  persons: number
  vehicles: number
  mapSpots: number
  clips: number
  linkedCases: number
}

async function main() {
  loadEnvironment()
  const apply = process.argv.slice(2).includes('--apply')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })

  try {
    const dossiers = await prisma.dossier.findMany({
      select: {
        id: true,
        kind: true,
        parentId: true,
        title: true,
        description: true,
        address: true,
        photoId: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        persons: { select: { id: true } },
        vehicles: { select: { id: true } },
        mapSpots: { select: { id: true } },
        clips: { select: { id: true } },
        investigations: { select: { id: true } },
      },
    })

    const plan = planDossierMigration(dossiers.map(({ id, kind, parentId }) => ({ id, kind, parentId })))
    if (!plan.conversions.length) {
      console.log('Nichts zu tun: keine Unterakten vorhanden.')
      return
    }

    const byId = new Map(dossiers.map(row => [row.id, row]))

    // Aktenzeichen einmal lesen und dann hochzählen. Pro Datensatz neu zu lesen
    // würde innerhalb derselben Transaktion immer dieselbe Nummer liefern und in
    // den Unique-Index auf `caseNumber` laufen.
    const existingNumbers = await prisma.investigation.findMany({ select: { caseNumber: true } })
    let sequence = existingNumbers.reduce(
      (max, row) => Math.max(max, parseSequenceNumber(INVESTIGATION_CASE_PREFIX, row.caseNumber) ?? 0),
      0,
    )

    const report: Report[] = []
    for (const conversion of plan.conversions) {
      const dossier = byId.get(conversion.id)!
      sequence += 1
      report.push({
        caseNumber: formatSequenceNumber(INVESTIGATION_CASE_PREFIX, sequence),
        dossierId: dossier.id,
        investigationId: '(wird beim Schreiben vergeben)',
        title: dossier.title,
        anchorId: conversion.anchorId,
        persons: dossier.persons.length,
        vehicles: dossier.vehicles.length,
        mapSpots: dossier.mapSpots.length,
        clips: dossier.clips.length,
        linkedCases: dossier.investigations.length,
      })
    }

    console.log(`\n${plan.conversions.length} Unterakte(n) werden zu Einsatzakten:`)
    for (const row of report) {
      const anchor = row.anchorId ? (byId.get(row.anchorId)?.title ?? row.anchorId) : 'ohne Dauerakte (freistehend)'
      console.log(
        `  ${row.caseNumber}  ${row.title}\n` +
          `      Dauerakte: ${anchor}\n` +
          `      Personen ${row.persons} · Fahrzeuge ${row.vehicles} · Kartenpunkte ${row.mapSpots} · ` +
          `Bodycams ${row.clips} (an Dauerakte) · verknüpfte Fälle ${row.linkedCases} (an Dauerakte)`,
      )
    }
    if (plan.reparents.length) {
      console.log(`\n${plan.reparents.length} Akte(n) werden hochgezogen:`)
      for (const row of plan.reparents) {
        const target = row.parentId ? (byId.get(row.parentId)?.title ?? row.parentId) : 'Wurzelebene'
        console.log(`  ${byId.get(row.id)?.title ?? row.id} → ${target}`)
      }
    }

    const dossierIds = new Set(plan.conversions.map(c => c.id))
    const affectedShareItems = (
      await prisma.recordShareItem.findMany({
        where: { kind: 'DOSSIER', recordId: { in: [...dossierIds] } },
        select: { id: true, shareId: true, kind: true, recordId: true },
      })
    ).filter(item => dossierIds.has(item.recordId))
    console.log(`\n${affectedShareItems.length} Eintrag/Einträge in Freigabelinks werden nachgezogen.`)

    if (!apply) {
      console.log('\nTrockenlauf – es wurde nichts geschrieben. Zum Ausführen:')
      console.log('  npm run db:backup && npm run db:migrate-unterakten -- --apply\n')
      return
    }

    const mapping = new Map<string, MigratedRecord>()

    await prisma.$transaction(
      async tx => {
        // Zuerst umhängen: `Dossier.parent` steht auf `onDelete: Restrict`,
        // eine Unterakte mit Kindern liesse sich sonst nicht löschen.
        for (const reparent of plan.reparents) {
          await tx.dossier.update({ where: { id: reparent.id }, data: { parentId: reparent.parentId } })
        }

        for (const row of report) {
          const dossier = byId.get(row.dossierId)!
          const investigation = await tx.investigation.create({
            data: {
              caseNumber: row.caseNumber,
              title: dossier.title,
              summary: migratedSummary(dossier.description, dossier.address),
              status: 'OPEN',
              priority: 'NORMAL',
              classified: false,
              ...(dossier.createdById ? { createdBy: { connect: { id: dossier.createdById } } } : {}),
              createdAt: dossier.createdAt,
              updatedAt: dossier.updatedAt,
              ...(dossier.photoId ? { photos: { connect: { id: dossier.photoId } } } : {}),
              ...(dossier.mapSpots.length
                ? { mapSpots: { connect: dossier.mapSpots.map(spot => ({ id: spot.id })) } }
                : {}),
              // Rolle `OTHER`, nicht der Prisma-Default `SUSPECT`: die alte
              // Unterakte kennt keine Rolle, ein Tatverdacht wäre erfunden.
              ...(dossier.persons.length
                ? { persons: { create: dossier.persons.map(person => ({ personId: person.id, role: 'OTHER' as const })) } }
                : {}),
              ...(dossier.vehicles.length
                ? { vehicles: { create: dossier.vehicles.map(vehicle => ({ vehicleId: vehicle.id })) } }
                : {}),
              ...(row.anchorId ? { dossiers: { connect: { id: row.anchorId } } } : {}),
            },
            select: { id: true, caseNumber: true, title: true },
          })
          row.investigationId = investigation.id
          mapping.set(dossier.id, {
            investigationId: investigation.id,
            title: `${investigation.caseNumber} · ${investigation.title}`,
          })

          // Clips hängen per Pflicht-Fremdschlüssel schon an einer eigenen
          // Einsatzakte; `Dossier.clips` ist nur eine zusätzliche Kuratierung.
          // Sie wandert samt den bereits verknüpften Fällen an die Dauerakte.
          if (row.anchorId) {
            await tx.dossier.update({
              where: { id: row.anchorId },
              data: {
                clips: { connect: dossier.clips.map(clip => ({ id: clip.id })) },
                investigations: { connect: dossier.investigations.map(item => ({ id: item.id })) },
              },
            })
          }
        }

        const existingKeys = new Set(
          (
            await tx.recordShareItem.findMany({
              where: { kind: 'CASE' },
              select: { shareId: true, recordId: true },
            })
          ).map(item => `${item.shareId}:CASE:${item.recordId}`),
        )
        const shares = planShareItemRewrites(affectedShareItems, mapping, existingKeys)
        for (const update of shares.updates) {
          await tx.recordShareItem.update({
            where: { id: update.id },
            data: { kind: update.kind, recordId: update.recordId, title: update.title },
          })
        }
        if (shares.deletes.length) {
          await tx.recordShareItem.deleteMany({ where: { id: { in: shares.deletes } } })
        }

        for (const conversion of plan.conversions) {
          await tx.dossier.delete({ where: { id: conversion.id } })
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 },
    )

    console.log('\nMigration abgeschlossen:')
    for (const row of report) {
      console.log(`  ${row.caseNumber}  ${row.title}\n      Dossier ${row.dossierId} → Investigation ${row.investigationId}`)
    }
    console.log('\nDie alten IDs stehen oben – für den Fall, dass etwas im Backup nachgeschlagen werden muss.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(cause => {
  console.error(cause)
  process.exit(1)
})
