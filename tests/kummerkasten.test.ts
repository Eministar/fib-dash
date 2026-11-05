import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectKummerkastenImage,
  kummerkastenNumber,
  parseKummerkastenInput,
} from '../src/lib/kummerkasten/kummerkasten'
import { splitMessage } from '../src/lib/kummerkasten/kummerkasten-forum'

const DISCORD_ID = '123456789012345678'

test('anonyme Einsendung verwirft alle Absenderfelder', () => {
  const input = parseKummerkastenInput({
    subject: 'Betreff',
    message: 'Text',
    anonymous: 'true',
    authorName: 'Max',
    authorDiscordId: DISCORD_ID,
    authorAvatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
  })
  assert.equal(input.anonymous, true)
  assert.equal(input.authorName, null)
  assert.equal(input.authorDiscordId, null)
  assert.equal(input.authorAvatarUrl, null)
  assert.ok(!JSON.stringify(input).includes(DISCORD_ID))
})

test('Einsendung mit Namen braucht Name und gültige Discord-ID', () => {
  const input = parseKummerkastenInput({ subject: ' Betreff ', message: 'Text', anonymous: 'false', authorName: '[12] Max', authorDiscordId: DISCORD_ID })
  assert.equal(input.subject, 'Betreff')
  assert.equal(input.authorName, '[12] Max')
  assert.equal(input.authorDiscordId, DISCORD_ID)
  assert.throws(() => parseKummerkastenInput({ subject: 'B', message: 'T', anonymous: 'false', authorName: 'Max', authorDiscordId: 'abc' }), /Discord-ID/)
  assert.throws(() => parseKummerkastenInput({ subject: 'B', message: 'T', anonymous: 'false', authorDiscordId: DISCORD_ID }), /Name/)
})

test('Pflichtfelder und Längen werden geprüft', () => {
  assert.throws(() => parseKummerkastenInput({ subject: '', message: 'T', anonymous: 'true' }), /Betreff/)
  assert.throws(() => parseKummerkastenInput({ subject: 'B', message: '  ', anonymous: 'true' }), /Nachricht/)
  assert.throws(() => parseKummerkastenInput({ subject: 'B', message: 'T', anonymous: 'vielleicht' }), /anonymous/)
  assert.throws(() => parseKummerkastenInput({ subject: 'x'.repeat(121), message: 'T', anonymous: 'true' }), /zu lang/)
  assert.throws(() => parseKummerkastenInput({ subject: 'B', message: 'x'.repeat(4001), anonymous: 'true' }), /zu lang/)
})

test('fremde Avatar-URLs werden ignoriert', () => {
  const input = parseKummerkastenInput({ subject: 'B', message: 'T', anonymous: 'false', authorName: 'Max', authorDiscordId: DISCORD_ID, authorAvatarUrl: 'https://evil.example/x.png' })
  assert.equal(input.authorAvatarUrl, null)
})

test('nur JPG und PNG werden als Bild erkannt', () => {
  assert.equal(detectKummerkastenImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.extension, 'jpg')
  assert.equal(detectKummerkastenImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension, 'png')
  assert.equal(detectKummerkastenImage(new TextEncoder().encode('GIF89a......')), null)
  assert.equal(detectKummerkastenImage(new TextEncoder().encode('<svg></svg>')), null)
})

test('Nummernformat und Aufteilen langer Texte', () => {
  assert.equal(kummerkastenNumber(42), 'KK-0042')
  assert.equal(kummerkastenNumber(12345), 'KK-12345')
  const parts = splitMessage(`${'a'.repeat(50)}\n${'b'.repeat(50)}`, 60)
  assert.deepEqual(parts, ['a'.repeat(50), 'b'.repeat(50)])
  assert.ok(splitMessage('x'.repeat(250), 100).every((part) => part.length <= 100))
})
