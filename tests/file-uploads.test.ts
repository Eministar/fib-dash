import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentMatchesType, FileUploadError, fileUploadPath, metaFromFormData } from '../src/lib/file-uploads'
import { extractUploadKey, generateUploadKey, hashUploadKey, UPLOAD_KEY_PREFIX } from '../src/lib/upload-keys'
import { normalizeUploadMime, previewKind } from '../src/lib/file-upload-types'
import { uploadListWhere } from '../src/lib/file-upload-queries'

test('Ein erzeugter Schlüssel ist lang, trägt das Präfix und wird nur als Hash gespeichert', () => {
  const key = generateUploadKey()
  assert.ok(key.plaintext.startsWith(UPLOAD_KEY_PREFIX))
  assert.ok(key.plaintext.length > 40, 'Der Schlüssel muss genug Entropie tragen')
  assert.equal(key.keyHash, hashUploadKey(key.plaintext))
  assert.notEqual(key.keyHash, key.plaintext)
  assert.ok(!key.prefix.includes(key.plaintext.slice(20)), 'Die Anzeigeform darf den Schlüssel nicht verraten')
  assert.notEqual(generateUploadKey().plaintext, key.plaintext)
})

test('Der Schlüssel wird aus X-Upload-Key gelesen, aus Bearer nur mit passendem Präfix', () => {
  assert.equal(extractUploadKey(new Headers({ 'x-upload-key': 'fibup_abc' })), 'fibup_abc')
  assert.equal(extractUploadKey(new Headers({ authorization: 'Bearer fibup_abc' })), 'fibup_abc')
  // Ein normaler API-Token darf hier NICHT als Upload-Schlüssel durchgehen.
  assert.equal(extractUploadKey(new Headers({ authorization: 'Bearer fib_abc' })), null)
  assert.equal(extractUploadKey(new Headers()), null)
})

test('Der MIME-Typ kommt aus dem Header, sonst aus der Endung; Unbekanntes wird abgelehnt', () => {
  assert.equal(normalizeUploadMime('text/html; charset=utf-8', 'x.html'), 'text/html')
  assert.equal(normalizeUploadMime('application/octet-stream', 'transkript.html'), 'text/html')
  assert.equal(normalizeUploadMime('', 'foto.JPEG'), 'image/jpeg')
  assert.equal(normalizeUploadMime('application/x-msdownload', 'setup.exe'), null)
  assert.equal(normalizeUploadMime('application/zip', 'archiv.zip'), null)
})

test('Der Inhalt muss zum Typ passen — Text über UTF-8, Binäres über die Signatur', () => {
  assert.equal(contentMatchesType('text/html', Buffer.from('<html>Hallo Ümläut</html>', 'utf8')), true)
  // Eine als HTML deklarierte Binärdatei fällt über Nullbytes auf.
  assert.equal(contentMatchesType('text/html', Buffer.from([0x4d, 0x5a, 0x00, 0x01])), false)
  assert.equal(contentMatchesType('text/plain', Buffer.from([0xff, 0xfe, 0xfd])), false)
  assert.equal(contentMatchesType('image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])), true)
  assert.equal(contentMatchesType('image/png', Buffer.from('nicht wirklich ein png')), false)
  assert.equal(contentMatchesType('application/pdf', Buffer.from('%PDF-1.7\n…')), true)
  assert.throws(() => contentMatchesType('application/json', Buffer.from('{kaputt')), FileUploadError)
  assert.equal(contentMatchesType('application/json', Buffer.from('{"ok":true}')), true)
})

test('Nur selbst vergebene Dateinamen sind gültige Pfade', () => {
  const valid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301.html'
  assert.ok(fileUploadPath(valid).endsWith(valid))
  for (const bad of ['../../etc/passwd', 'transkript.html', '3f2504e0-4f89-11d3-9a0c-0305e82c3301.exe', '']) {
    assert.throws(() => fileUploadPath(bad), FileUploadError, `"${bad}" darf kein gültiger Pfad sein`)
  }
})

test('Metadaten aus dem Formular: Tags werden geteilt und entdoppelt, metadata muss ein JSON-Objekt sein', () => {
  const form = new FormData()
  form.append('title', '  Ticket #12  ')
  form.append('tags', 'ticket, support ,ticket')
  form.append('tags', 'beschwerde')
  form.append('externalRef', '12')
  form.append('metadata', '{"kanal":"support"}')
  const meta = metaFromFormData(form)
  assert.equal(meta.title, 'Ticket #12')
  assert.deepEqual(meta.tags, ['ticket', 'support', 'beschwerde'])
  assert.deepEqual(meta.metadata, { kanal: 'support' })

  const broken = new FormData()
  broken.append('metadata', 'kein json')
  assert.throws(() => metaFromFormData(broken), FileUploadError)

  const arrayMeta = new FormData()
  arrayMeta.append('metadata', '[1,2,3]')
  assert.throws(() => metaFromFormData(arrayMeta), FileUploadError)

  const badUrl = new FormData()
  badUrl.append('externalUrl', 'kein-link')
  assert.throws(() => metaFromFormData(badUrl), FileUploadError)
})

test('Die Upload-Liste filtert ohne Suchbegriff nicht — ein leerer OR-Zweig liefert null Treffer', () => {
  assert.deepEqual(uploadListWhere({ search: '', category: '', tag: '', from: '', to: '' }), {})
  const filtered = uploadListWhere({ search: 'ticket', category: 'Transkript', tag: '', from: '', to: '' })
  assert.equal(filtered.category, 'Transkript')
  assert.equal(filtered.OR?.length, 5)
  // Ein unlesbares Datum darf den Filter nicht in einen Invalid-Date-Vergleich kippen.
  assert.deepEqual(uploadListWhere({ search: '', category: '', tag: '', from: 'morgen', to: '' }), {})
})

test('Die Vorschau richtet sich nach dem Typ', () => {
  assert.equal(previewKind('text/html'), 'html')
  assert.equal(previewKind('image/png'), 'image')
  assert.equal(previewKind('application/pdf'), 'pdf')
  assert.equal(previewKind('video/mp4'), 'video')
  assert.equal(previewKind('text/csv'), 'text')
})
