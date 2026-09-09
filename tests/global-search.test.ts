import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SEARCH_MIN_LENGTH, excerpt } from '../src/lib/global-search'

test('Der Ausschnitt zentriert die Fundstelle statt den Feldanfang zu zeigen', () => {
  const text = `${'a'.repeat(200)} Moretti ${'b'.repeat(200)}`
  const result = excerpt(text, 'Moretti')
  assert.ok(result)
  assert.ok(result.includes('Moretti'), 'Der Suchbegriff muss im Ausschnitt stehen')
  assert.ok(result.startsWith('…') && result.endsWith('…'), 'Beidseitig gekürzt')
  assert.ok(result.length < 120, 'Der Ausschnitt bleibt kurz')
})

test('Ohne Fundstelle im Feld kommt der gekürzte Anfang zurück', () => {
  const result = excerpt('c'.repeat(300), 'Moretti')
  assert.ok(result)
  assert.ok(result.endsWith('…'))
  assert.ok(!result.startsWith('…'), 'Vorne wird nichts abgeschnitten, wenn ab Anfang gezeigt wird')
})

test('Leere und fehlende Felder liefern keinen Ausschnitt', () => {
  for (const value of [null, undefined, '', '   ']) {
    assert.equal(excerpt(value, 'x'), undefined)
  }
})

test('Kurze Texte kommen unverändert und ohne Auslassungszeichen zurück', () => {
  assert.equal(excerpt('Familie Moretti', 'Moretti'), 'Familie Moretti')
})

test('Zeilenumbrüche und Mehrfachleerzeichen werden zu einer Zeile geglättet', () => {
  assert.equal(excerpt('Familie\n\n  Moretti', 'Moretti'), 'Familie Moretti')
})

test('Die Fundstelle wird unabhängig von Groß- und Kleinschreibung gesucht', () => {
  assert.equal(excerpt('Familie MORETTI', 'moretti'), 'Familie MORETTI')
})

test('Ein Zeichen ist als Suchbegriff zu kurz', () => {
  assert.equal(SEARCH_MIN_LENGTH, 2)
})
