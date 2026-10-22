import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_ALERT_SETTINGS,
  buildAgentNameIndex,
  evaluateWithdrawals,
  isWeaponItem,
  itemLabel,
  normalizePersonName,
  parseStorageEmbed,
  snowflakeAt,
  storageSlug,
} from '../src/lib/storage-logs'

test('liest die echten Fraklager-Embeds', () => {
  assert.deepEqual(parseStorageEmbed({ title: 'Eingelagert', description: 'Niklas Dior hat 1x WEAPON_PISTOL50 in Lager eingelagert.' }), {
    direction: 'IN', actorName: 'Niklas Dior', quantity: 1, item: 'WEAPON_PISTOL50', storage: 'Lager',
    rawText: 'Niklas Dior hat 1x WEAPON_PISTOL50 in Lager eingelagert.',
  })
  assert.equal(parseStorageEmbed({ title: 'Eingelagert', description: 'Niklas Dior hat 7x phone in Lager eingelagert.' })?.quantity, 7)
})

test('erkennt Entnahmen in verschiedenen Formulierungen', () => {
  for (const text of [
    'Max Muster hat 3x kokain1 aus Lager ausgelagert.',
    'Max Muster hat 3x kokain1 aus dem Lager entnommen.',
    'Max Muster hat 3x kokain1 aus Waffenlager genommen',
  ]) {
    const entry = parseStorageEmbed({ title: 'Ausgelagert', description: text })
    assert.equal(entry?.direction, 'OUT', text)
    assert.equal(entry?.quantity, 3)
    assert.equal(entry?.item, 'kokain1')
  }
  // Nur der Titel verrät die Richtung.
  assert.equal(parseStorageEmbed({ title: 'Ausgelagert', description: 'Max Muster hat 2x gps aus Lager bewegt.' })?.direction, 'OUT')
})

test('Doppelnamen und fremde Nachrichten', () => {
  assert.equal(parseStorageEmbed({ description: 'Anna Maria von Berg hat 2x phone in Lager eingelagert.' })?.actorName, 'Anna Maria von Berg')
  assert.equal(parseStorageEmbed({ title: 'Info', description: 'Server startet neu.' }), null)
  assert.equal(parseStorageEmbed({ description: 'X hat 0x phone in Lager eingelagert.' }), null)
  assert.equal(parseStorageEmbed({}), null)
})

test('Namensabgleich: tolerant, aktive Agents zuerst', () => {
  assert.equal(normalizePersonName('  Niklas   DIÖR '), 'niklas dior')
  const index = buildAgentNameIndex([
    { id: 'old', firstName: 'Niklas', lastName: 'Dior', status: 'TERMINATED' },
    { id: 'new', firstName: 'Niklas', lastName: 'Dior', status: 'ACTIVE' },
  ])
  assert.equal(index.get(normalizePersonName('niklas dior')), 'new')
})

test('Waffen erkennen und Gegenstände lesbar machen', () => {
  assert.equal(isWeaponItem('WEAPON_PISTOL50'), true)
  assert.equal(isWeaponItem('WEAPON_SWITCHBLADE'), true)
  assert.equal(isWeaponItem('weed1'), false)
  assert.equal(isWeaponItem('ammo_box', ['ammo']), true)
  assert.equal(itemLabel('WEAPON_PISTOL50'), 'Pistol50')
  assert.equal(itemLabel('kokain1'), 'Kokain1')
})

test('Slugs: Präfix und verwechslungsfreie Zeichen', () => {
  const slug = storageSlug('LAG')
  assert.match(slug, /^LAG-[2-9A-HJKMNP-Z]{6}$/)
  assert.equal(storageSlug('WARN', () => 0), 'WARN-222222')
})

test('Snowflake aus Zeitpunkt', () => {
  assert.equal(snowflakeAt(new Date(1420070400000)), '0')
  assert.equal(BigInt(snowflakeAt(new Date('2026-10-22T00:00:00Z'))) > BigInt(0), true)
})

test('Auffälligkeit: Menge im Zeitfenster zählt, alte Einträge nicht', () => {
  const now = new Date('2026-10-22T18:30:00Z')
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000)
  const entries = [
    { slug: 'A', quantity: 2, isWeapon: true, occurredAt: at(10) },
    { slug: 'B', quantity: 3, isWeapon: true, occurredAt: at(2) },
    { slug: 'C', quantity: 10, isWeapon: true, occurredAt: at(40) },
  ]
  const result = evaluateWithdrawals(entries, now, DEFAULT_ALERT_SETTINGS)
  assert.equal(result?.weaponCount, 5)
  assert.deepEqual(result?.reasons, ['weapons'])
  assert.deepEqual(result?.slugs, ['A', 'B'])
  assert.equal(evaluateWithdrawals(entries.slice(0, 1), now, DEFAULT_ALERT_SETTINGS), null)
  const bulk = [{ slug: 'D', quantity: 30, isWeapon: false, occurredAt: at(1) }]
  assert.deepEqual(evaluateWithdrawals(bulk, now, DEFAULT_ALERT_SETTINGS)?.reasons, ['items'])
  assert.equal(evaluateWithdrawals(bulk, now, { ...DEFAULT_ALERT_SETTINGS, itemThreshold: 0 }), null)
})

test('Warnung pingt genau die eingestellte Person und verlinkt die Einträge', async () => {
  const { storageAlertMessage } = await import('../src/lib/storage-logs')
  const message = storageAlertMessage({
    userId: '928021462386892830', actorName: 'Niklas Dior', agentLabel: 'Niklas Dior (FIB-12)',
    weaponCount: 6, itemCount: 6, windowMinutes: 15, reasons: ['weapons'], alertSlug: 'WARN-ABCDEF',
    baseUrl: 'https://dash.test',
    entries: [{ slug: 'LAG-AAAAAA', item: 'WEAPON_PISTOL50', quantity: 6, isWeapon: true, occurredAt: new Date('2026-10-22T18:40:00Z') }],
  })
  const json = JSON.stringify(message)
  assert.deepEqual(message.allowed_mentions, { parse: [], users: ['928021462386892830'] })
  assert.ok(!('content' in message))
  assert.ok(json.includes('<@928021462386892830>'))
  assert.ok(json.includes('6 Waffen'))
  assert.ok(json.includes('https://dash.test/leadership/storage/LAG-AAAAAA'))
  assert.ok(json.includes('alert=WARN-ABCDEF'))
})
