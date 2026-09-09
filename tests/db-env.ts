/**
 * Tests laufen nie gegen die Produktionsdatenbank. `.env.test` liefert eine
 * eigene `DATABASE_URL`; ohne sie bricht der Testlauf ab, statt versehentlich
 * Zeilen in echten Daten anzulegen.
 *
 * Muss vor jedem Import von `@/lib/prisma` ausgewertet werden, deshalb steht
 * dieses Modul in den Testdateien ganz oben.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const file = path.join(process.cwd(), '.env.test')

let url: string | null = null
try {
  const match = readFileSync(file, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
  url = match?.[1] ?? null
} catch {
  url = null
}

if (!url) {
  throw new Error(
    'Für Datenbanktests fehlt .env.test mit einer eigenen DATABASE_URL. ' +
      'Niemals gegen die Produktionsdatenbank testen.',
  )
}
if (/\/fib_dash(\?|$)/.test(url)) {
  throw new Error('.env.test zeigt auf die Produktionsdatenbank fib_dash. Bitte eine eigene Datenbank verwenden.')
}

process.env.DATABASE_URL = url
