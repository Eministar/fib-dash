import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restyleComponents, restyleDiscordText } from '../src/lib/discord/discord-restyle'

test('alte Abmeldung bekommt großen Titel, Agent-Zeile und Zeilen mit `emoji` ›', () => {
  const old = [
    '## 📝 Abmeldung · Agent Bearchen',
    '<@123456789012345678> · `[101]` · <@&223456789012345678>',
  ].join('\n')
  assert.equal(restyleDiscordText(old), [
    '# `📝` Abmeldung · Agent Bearchen',
    '`👤` › <@123456789012345678> · `🪪` › `[101]` · `🎖️` › <@&223456789012345678>',
  ].join('\n'))

  const rows = '> Für den genannten Zeitraum liegt eine Abmeldung vor.\n\n🏁 **Bis:** 26.10.26, 00:59\n📝 **Grund:** auswahllehrgang'
  assert.equal(
    restyleDiscordText(rows),
    '> Für den genannten Zeitraum liegt eine Abmeldung vor.\n\n`🏁` › **Bis:** 26.10.26, 00:59\n`📝` › **Grund:** auswahllehrgang',
  )
})

test('Umwandlung ist idempotent', () => {
  const old = '## 📝 Titel\n**Max Muster** · `[7]`\n▫️ **Pfad:** /agents\n### 🟢 Aktuell im Dienst\n> 🏁 Rückkehr morgen'
  const once = restyleDiscordText(old)
  assert.equal(restyleDiscordText(once), once)
  assert.match(once, /^`👤` › \*\*Max Muster\*\* · `🪪` › `\[7\]`$/m)
  assert.match(once, /^### `🟢` › Aktuell im Dienst$/m)
  assert.match(once, /^> `🏁` › Rückkehr morgen$/m)
})

test('Zwischenüberschriften, Kleintext, Code-Blöcke und Fließtext bleiben sinnvoll', () => {
  assert.equal(restyleDiscordText('### `👥` Familien & Leitungen'), '### `👥` › Familien & Leitungen')
  assert.equal(restyleDiscordText('-# 🗂️ Einsatzakte `ERM-1`'), '-# 🗂️ Einsatzakte `ERM-1`')
  assert.equal(restyleDiscordText('```\n📝 bleibt\n```'), '```\n📝 bleibt\n```')
  assert.equal(restyleDiscordText('Guten Tag, bitte prüfen.'), 'Guten Tag, bitte prüfen.')
  assert.equal(restyleDiscordText('### Ohne Emoji'), '### Ohne Emoji')
})

test('mehrere Angaben in einer Zeile werden einzeln umgestellt', () => {
  assert.equal(
    restyleDiscordText('🟢 **Offen**　🔴 Priorität Hoch'),
    '`🟢` › **Offen**　`🔴` › Priorität Hoch',
  )
  assert.equal(
    restyleDiscordText('`01`  👤 **Max**  ·  🎖️ `Agent`'),
    '`01`  `👤` › **Max**  ·  `🎖️` › `Agent`',
  )
})

test('Verlaufsmeldungen im Forum: Zeilen wie markdownRows', () => {
  assert.equal(
    restyleDiscordText('### 🤝 Fallführung übergeben\n**Von** A\n**Ort** Pier 4'),
    '### `🤝` › Fallführung übergeben\n`📅` › **Von:** A\n`📍` › **Ort:** Pier 4',
  )
})

test('bekannte Abschnitte und Familienregister bekommen ihr Symbol', () => {
  assert.equal(restyleDiscordText('**Meiste Dienstzeit**'), '`🏆` › **Meiste Dienstzeit**')
  assert.equal(restyleDiscordText('<#111> · 3 Akten'), '`📁` › <#111> · 3 Akten')
})

test('Component-Baum: nur Text-Displays werden geändert, sonst null', () => {
  const tree = [{ type: 17, components: [{ type: 10, content: '## ⚠️ Titel' }, { type: 1, components: [{ type: 2, label: '## bleibt' }] }] }]
  const result = restyleComponents(tree) as typeof tree
  assert.equal((result[0].components[0] as { content: string }).content, '# `⚠️` Titel')
  assert.equal(restyleDiscordText('# 📊 Wochenbericht'), '# `📊` Wochenbericht')
  assert.equal(restyleDiscordText('## Einsatzakte ohne Emoji'), '# Einsatzakte ohne Emoji')
  assert.equal((result[0].components[1] as { components: { label: string }[] }).components[0].label, '## bleibt')
  assert.equal(restyleComponents(result), null)
})
