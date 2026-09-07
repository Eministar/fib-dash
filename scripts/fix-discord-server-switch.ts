import 'dotenv/config'

import { prisma } from '@/lib/prisma'
import { getDiscordConfig } from '@/lib/discord-integration'

/**
 * Recovery nach einem Discord-Server-Wechsel.
 *
 * Problem: getDiscordConfig() nimmt IMMER die in der DB gespeicherten
 * discord.*-Werte zuerst; die .env ist nur Fallback, wenn der DB-Key fehlt.
 * Nach einem Serverwechsel stehen in der DB noch die ALTEN Guild-/Rollen-IDs,
 * deshalb wird die (korrekte) neue .env-Konfiguration komplett ignoriert und
 * man sperrt sich aus ("Dir fehlt die benötigte Discord-Rolle").
 *
 * Dieses Script löscht die veralteten DB-Override-Keys, sodass die .env wieder
 * greift. Login + Admin laufen danach wieder über die echten Discord-Rollen.
 *
 * MUSS AUF DEM SERVER laufen (dort, wo die echte .env + DATABASE_URL liegen):
 *
 *   Dry-Run (zeigt nur an, ändert nichts):
 *     npx tsx scripts/fix-discord-server-switch.ts
 *
 *   Anwenden (löscht die Override-Keys):
 *     npx tsx scripts/fix-discord-server-switch.ts --apply
 */

// Keys, deren .env-Fallback nach dem Löschen wieder greift bzw. die sonst auf
// den alten Server zeigen. authGroupRoleMap/Legacy haben keinen .env-Fallback
// und werden geleert — die Gruppen-Zuordnung baust du danach im UI neu auf.
const STALE_KEYS = [
  'discord.guildId',
  'discord.authLoginRoleIds',
  'discord.adminRoleIds',
  'discord.authGroupRoleMap',
  'discord.authRoleGroupMap', // legacy
]

async function main() {
  const apply = process.argv.includes('--apply')

  const stored = await prisma.systemSetting.findMany({
    where: { key: { in: STALE_KEYS } },
    orderBy: { key: 'asc' },
  })

  console.log('\n=== Aktuell in der DB gespeichert (Override über .env) ===\n')
  if (stored.length === 0) {
    console.log('  (keine dieser Keys in der DB — .env ist bereits maßgeblich)')
  } else {
    for (const row of stored) {
      const v = row.value.length > 200 ? row.value.slice(0, 200) + '…' : row.value
      console.log(`  ${row.key.padEnd(30)} = ${v}`)
    }
  }

  if (!apply) {
    // getDiscordConfig() mischt DB + .env; nach dem Löschen entspricht das dem
    // reinen .env-Stand. Wir zeigen es zur Kontrolle (Achtung: solange noch DB-
    // Werte da sind, sieht man hier die DB-Werte).
    const cfg = await getDiscordConfig()
    console.log('\n=== Effektive Config JETZT (DB hat Vorrang) ===\n')
    console.log(`  guildId          = ${cfg.guildId || '(leer)'}`)
    console.log(`  authLoginRoleIds = ${JSON.stringify(cfg.authLoginRoleIds)}`)
    console.log(`  adminRoleIds     = ${JSON.stringify(cfg.adminRoleIds)}`)
    console.log('\nDry-Run — es wurde nichts geändert.')
    console.log('Zum Anwenden:  npx tsx scripts/fix-discord-server-switch.ts --apply\n')
    return
  }

  const result = await prisma.systemSetting.deleteMany({ where: { key: { in: STALE_KEYS } } })
  console.log(`\n✅ ${result.count} Override-Key(s) gelöscht — die .env greift jetzt wieder.\n`)

  const cfg = await getDiscordConfig()
  console.log('=== Effektive Config NACH dem Löschen (jetzt aus .env) ===\n')
  console.log(`  guildId          = ${cfg.guildId || '(LEER — DISCORD_GUILD_ID im Server-.env fehlt!)'}`)
  console.log(`  authLoginRoleIds = ${JSON.stringify(cfg.authLoginRoleIds)}`)
  console.log(`  adminRoleIds     = ${JSON.stringify(cfg.adminRoleIds)}`)

  if (!cfg.guildId) {
    console.log('\n⚠️  guildId ist leer! Setze im Server-.env DISCORD_GUILD_ID="<neue-guild-id>" und prüfe erneut.')
  }
  if (cfg.authLoginRoleIds.length === 0) {
    console.log('\n⚠️  authLoginRoleIds ist leer! Prüfe DISCORD_AUTH_LOGIN_ROLE_IDS im Server-.env.')
  }
  console.log('\nDanach: neu mit Discord einloggen. Admin-Rechte kommen live über DISCORD_ADMIN_ROLE_IDS.\n')
}

main()
  .catch((e) => { console.error('Fehler:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
