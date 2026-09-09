/**
 * Überführt die Unterschriftsdaten bestehender Verträge in das Modell
 * `ContractSignature`.
 *
 *   npx tsx scripts/migrate-contract-signatures.ts          (Probelauf)
 *   npx tsx scripts/migrate-contract-signatures.ts --apply  (schreibt)
 *
 * Die Logik liegt in `src/lib/contract-signature-migration.ts` und ist dort
 * getestet; dieses Skript ist nur die Kommandozeile davor.
 */
import { prisma } from '../src/lib/prisma'
import { migrateContractSignatures } from '../src/lib/contract-signature-migration'

const apply = process.argv.includes('--apply')

migrateContractSignatures({ dryRun: !apply })
  .then((count) => {
    if (apply) {
      console.log(`${count} Unterschriftszeile(n) angelegt.`)
    } else if (count === 0) {
      console.log('Nichts zu tun: alle Verträge haben bereits eine Unterschriftszeile.')
    } else {
      console.log(`\n${count} Vertrag/Verträge würden übernommen. Mit --apply ausführen.`)
    }
  })
  .catch((cause) => {
    console.error('Migration fehlgeschlagen:', cause)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
