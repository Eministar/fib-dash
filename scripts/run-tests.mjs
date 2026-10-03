// Startet alle Tests unter tests/. Datenbanktests (*-db.test.ts, *-e2e.test.ts)
// brauchen eine eigene .env.test und laufen nur mit --db bzw. --all.
//
//   node scripts/run-tests.mjs          → nur Tests ohne Datenbank
//   node scripts/run-tests.mjs --db     → nur Datenbanktests
//   node scripts/run-tests.mjs --all    → alles
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const mode = args.includes('--all') ? 'all' : args.includes('--db') ? 'db' : 'unit'
const isDbTest = (file) => /-(db|e2e)\.test\.ts$/.test(file)

const files = readdirSync('tests')
  .filter((file) => file.endsWith('.test.ts'))
  .filter((file) => mode === 'all' || (mode === 'db') === isDbTest(file))
  .sort()
  .map((file) => `tests/${file}`)

if (files.length === 0) {
  console.log('Keine Tests gefunden.')
  process.exit(0)
}

const result = spawnSync('npx', ['tsx', '--test', ...files], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
