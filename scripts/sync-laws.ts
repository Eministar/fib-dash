/**
 * Notfallkopie des Gesetzbuchs aktualisieren.
 *
 *   npm run laws:sync
 *
 * Das Dashboard holt die Gesetze live von https://fjd.kian-hahn.de/recht
 * (siehe `src/lib/laws/laws.ts`). `src/data/laws.json` wird nur benutzt, wenn
 * die Seite beim Abruf nicht erreichbar ist. Ab und zu neu erzeugen schadet nicht.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fetchLawbook } from '../src/lib/laws/fjd-parser'

const OUT = join(process.cwd(), 'src', 'data', 'laws.json')

async function main() {
  const book = await fetchLawbook(30_000)
  for (const law of book.laws) console.log(`${law.abbr.padEnd(12)} ${String(law.norms.length).padStart(4)} Normen · ${law.name}`)
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(book, null, 1)}\n`)
  console.log(`\n${book.laws.length} Gesetze, ${book.laws.reduce((sum, law) => sum + law.norms.length, 0)} Normen → ${OUT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
