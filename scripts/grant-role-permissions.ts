import path from 'node:path'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../src/generated/prisma/client'
import dotenv from 'dotenv'

import { PERMISSIONS, PERMISSION_LABELS, sanitizePermissions, type Permission } from '../src/lib/permissions'

const SETTING_KEY = 'discord.authRolePermissionMap'

function loadEnvironment() {
  dotenv.config({ path: path.join(process.cwd(), '.env.local') })
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: false })
}

function usage() {
  return [
    'Rechte einer Discord-Rolle zuweisen (zaehlt automatisch als Login-Rolle).',
    '',
    'Beispiele:',
    '  npx tsx scripts/grant-role-permissions.ts 1548003570081861732 map:view map:manage',
    '  npx tsx scripts/grant-role-permissions.ts 1548003570081861732 --remove',
    '  npx tsx scripts/grant-role-permissions.ts --list',
    '',
    'Ohne --replace werden die Rechte zu den bereits hinterlegten hinzugefuegt.',
  ].join('\n')
}

function parseMap(value: string | undefined): Record<string, Permission[]> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).map(([roleId, permissions]) => [roleId, sanitizePermissions(permissions)]),
    )
  } catch {
    return {}
  }
}

async function main() {
  const args = process.argv.slice(2)
  const list = args.includes('--list')
  const remove = args.includes('--remove')
  const replace = args.includes('--replace')
  const positional = args.filter((arg) => !arg.startsWith('--'))
  const roleId = positional[0]
  const requested = positional.slice(1)

  if (!list && !roleId) {
    console.log(usage())
    process.exitCode = 1
    return
  }

  if (roleId && !/^\d{17,22}$/.test(roleId)) {
    throw new Error(`"${roleId}" ist keine gueltige Discord-Rollen-ID.`)
  }

  const unknown = requested.filter((permission) => !(PERMISSIONS as readonly string[]).includes(permission))
  if (unknown.length > 0) {
    throw new Error(`Unbekannte Rechte: ${unknown.join(', ')}`)
  }
  if (!list && !remove && requested.length === 0) {
    throw new Error('Keine Rechte angegeben. Zum Entfernen --remove verwenden.')
  }

  loadEnvironment()
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt in .env.local oder .env.')

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) })
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } })
    const map = parseMap(row?.value)

    if (list) {
      const entries = Object.entries(map)
      if (entries.length === 0) {
        console.log('Keine Rolle hat direkte Rechte.')
      } else {
        for (const [id, permissions] of entries) {
          console.log(`${id}: ${permissions.join(', ') || '(keine)'}`)
        }
      }
      return
    }

    const current = map[roleId!] ?? []
    const next = remove
      ? []
      : replace
        ? sanitizePermissions(requested)
        : sanitizePermissions([...current, ...requested])

    if (next.length > 0) map[roleId!] = next
    else delete map[roleId!]

    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(map) },
      update: { value: JSON.stringify(map) },
    })

    console.log(`Rolle ${roleId}:`)
    console.log(`  vorher:  ${current.join(', ') || '(keine)'}`)
    console.log(`  nachher: ${next.map((permission) => `${permission} (${PERMISSION_LABELS[permission]})`).join(', ') || '(keine)'}`)
    console.log('\nDie Rechte greifen beim naechsten Discord-Login der betroffenen Mitglieder.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Rechtevergabe fehlgeschlagen.')
  process.exitCode = 1
})
