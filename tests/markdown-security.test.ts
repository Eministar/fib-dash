import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../src/lib/markdown'
import { markdownCode, markdownRows } from '../src/lib/discord-components'

test('reference definitions cannot break out of href or title attributes', () => {
  const html = renderMarkdown([
    'Siehe [Link][x].',
    '',
    `[x]: https://a"onmouseover="alert(1) 'ti"tle'`,
  ].join('\n'))
  assert.doesNotMatch(html, /"onmouseover=/)
  assert.match(html, /href="https:\/\/a&quot;onmouseover=&quot;alert\(1\)"/)
  assert.match(html, /title="ti&quot;tle"/)
})

test('footnote ids are escaped and still link to their references', () => {
  const html = renderMarkdown('Text[^ok].\n\n[^ok]: gut\n[^a"onmouseover="alert(1)]: böse')
  assert.doesNotMatch(html, /"onmouseover=/)
  assert.match(html, /<sup id="fnref-ok"><a href="#fn-ok">ok<\/a><\/sup>/)
  assert.match(html, /<li id="fn-ok">gut/)
})

test('several footnote references on one line are not swallowed by superscript', () => {
  const html = renderMarkdown('A[^1] und B[^2], x^2^.\n\n[^1]: eins\n[^2]: zwei')
  assert.match(html, /href="#fn-1"/)
  assert.match(html, /href="#fn-2"/)
  assert.match(html, /x<sup>2<\/sup>/)
})

test('discord row values go into code spans while mentions and timestamps stay clickable', () => {
  assert.equal(markdownCode('`PG 3` · Mittelschwer'), '`PG 3` · `Mittelschwer`')
  assert.equal(markdownCode('FIB-12 → **FIB-07**'), '`FIB-12` → `FIB-07`')
  assert.equal(markdownCode('12.10.2026 · <t:1791000000:R>'), '`12.10.2026` · <t:1791000000:R>')
  assert.equal(markdownCode('<@123456789012345678>'), '<@123456789012345678>')
  assert.equal(markdownRows([{ label: 'Grund', value: 'Fehlen' }]), '`📝` **Grund:** `Fehlen`')
})
