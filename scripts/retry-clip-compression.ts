/**
 * Stellt fehlgeschlagene Clip-Komprimierungen zurück in die Warteschlange.
 *
 *   npx tsx scripts/retry-clip-compression.ts          (zeigt nur an)
 *   npx tsx scripts/retry-clip-compression.ts --apply  (setzt zurück)
 *
 * FAILED ist sonst eine Sackgasse: der Worker nimmt nur PENDING und
 * abgelaufene PROCESSING auf. Ohne diesen Weg lässt sich ein Fehlschlag nach
 * einer Korrektur an der Serverumgebung nicht erneut versuchen.
 */
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'

const apply = process.argv.includes('--apply')

async function main() {
  const failed = await prisma.bodycamClip.findMany({
    where: { compressionStatus: 'FAILED' },
    select: { id: true, title: true, compressionError: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!failed.length) {
    console.log('Keine fehlgeschlagenen Komprimierungen.')
    return
  }

  for (const clip of failed) {
    console.log(`- ${clip.title}`)
    console.log(`  ${clip.compressionError ?? '(kein Grund gespeichert)'}`)
  }

  if (!apply) {
    console.log(`\n${failed.length} Clip(s) würden zurückgestellt. Mit --apply ausführen.`)
    return
  }

  const { count } = await prisma.bodycamClip.updateMany({
    where: { compressionStatus: 'FAILED' },
    data: { compressionStatus: 'PENDING', compressionError: null, compressionStartedAt: null },
  })
  console.log(`\n${count} Clip(s) zurückgestellt. Der Worker greift sie binnen einer Minute auf.`)
}

main()
  .catch((cause) => {
    console.error('Fehlgeschlagen:', cause)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
