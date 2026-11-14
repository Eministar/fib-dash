import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLawIndex, parseLawPage, type Lawbook } from '../src/lib/laws/fjd-parser'
import { buildCatalog } from '../src/lib/laws/laws'
import { normalizeCharges } from '../src/lib/laws/charges-server'
import { chargeLine, mergeCharges, readCharges } from '../src/lib/investigations/charges'
import { readDraftEntries } from '../src/lib/investigations/draft-entries'
import { emptyRaidRequest, raidDocument } from '../src/lib/investigations/raid-request'
import { buildSystemPrompt, buildUserPrompt, parseEntriesPlan, parseSuggestion, readChanges } from '../src/lib/ai/ai-prompts'
import { splitText } from '../src/components/investigations/binder/a4-pages'

const INDEX = `<main><section><h2 class="x">Strafrecht und Strafverfahren</h2><ul>
<li class="a"><a class="b" href="/recht/stgb">Strafgesetzbuch<!-- --> <span class="muted">(<!-- -->StGB<!-- -->)</span></a><span class="muted text-xs">Gesetz<!-- --> · Stand <a href="/recht/bekanntmachungen/2026-001">BK-2026/001</a> vom <!-- -->26.10.2026</span></li>
</ul></section><section><h2>Verfassung</h2><ul><li><a href="/recht/gg">Grundgesetz <span>(GG)</span></a><span>Gesetz · Stand BK-2026/001</span></li></ul></section></main>`

const PAGE = `<nav aria-label="Inhaltsverzeichnis" class="n"><ul>
<li class="pt-2">Besonderer Teil</li>
<li><a href="#p9" title="§ 9 Diebstahl"><span class="tabular-nums">§ 9</span> <!-- -->Diebstahl</a></li>
<li><a href="#p13" title="§ 13 Unterlassene Hilfeleistung"><span class="tabular-nums">§ 13</span> <!-- -->Unterlassene Hilfeleistung</a></li>
</ul></nav><nav aria-label="Inhaltsverzeichnis">doppelt</nav>
<section id="p9" class="recht-norm scroll-mt-20"><h3><a href="/recht/stgb/9">§ 9 Diebstahl</a></h3><div><p><span>Wer einem anderen eine fremde Sache wegnimmt, wird mit 15 HE &amp; 4.500 $ bestraft.</span></p></div></section>
<section id="p13" class="recht-norm scroll-mt-20"><h3>§ 13 Unterlassene Hilfeleistung</h3><div><div id="p13-abs1" class="recht-abs flex"><span><a>(<!-- -->1<!-- -->)</a></span><div>Wer nicht hilft, wird bestraft.</div></div><div id="p13-abs2" class="recht-abs flex"><span><a>(2)</a></span><div>Ebenso:<ol><li>1.erstens</li></ol></div></div></div></section>`

function book(): Lawbook {
  return {
    source: 'test', syncedAt: '2026-11-14T00:00:00.000Z',
    laws: [
      { code: 'stgb', abbr: 'StGB', name: 'Strafgesetzbuch', kind: 'Gesetz', group: 'Strafrecht', status: '', url: 'https://x/recht/stgb', norms: parseLawPage(PAGE) },
      { code: 'stpo', abbr: 'StPO', name: 'Strafprozessordnung', kind: 'Ordnung', group: 'Strafrecht', status: '', url: 'https://x/recht/stpo', norms: [{ id: 'p9', number: '§ 9', title: 'Beschlagnahme', section: null, text: 'Gegenstände können beschlagnahmt werden.' }] },
    ],
  }
}

test('FJD-Übersicht: Gruppen, Kürzel, Art und Stand werden gelesen', () => {
  const laws = parseLawIndex(INDEX)
  assert.deepEqual(laws[0], { code: 'stgb', name: 'Strafgesetzbuch', abbr: 'StGB', kind: 'Gesetz', group: 'Strafrecht und Strafverfahren', status: 'BK-2026/001 vom 26.10.2026' })
  assert.equal(laws[1].abbr, 'GG')
  assert.equal(laws[1].group, 'Verfassung')
})

test('FJD-Gesetz: Nummer und Titel aus dem Inhaltsverzeichnis, Absätze und Aufzählungen als Zeilen', () => {
  const norms = parseLawPage(PAGE)
  assert.equal(norms.length, 2)
  assert.deepEqual({ ...norms[0], text: undefined }, { id: 'p9', number: '§ 9', title: 'Diebstahl', section: 'Besonderer Teil', text: undefined })
  assert.match(norms[0].text, /15 HE & 4\.500 \$ bestraft/)
  assert.equal(norms[1].text, '(1) Wer nicht hilft, wird bestraft.\n(2) Ebenso:\n• 1. erstens')
})

test('Fundstellen werden tolerant und eindeutig aufgelöst', () => {
  const catalog = buildCatalog(book(), 'fallback')
  assert.equal(catalog.resolve('stgb:p9')?.title, 'Diebstahl')
  assert.equal(catalog.resolve('§ 9 StGB')?.ref, 'stgb:p9')
  assert.equal(catalog.resolve('StGB 13')?.label, '§ 13 StGB')
  assert.equal(catalog.resolve('§ 9 StPO')?.ref, 'stpo:p9', 'StPO nicht mit StGB verwechseln')
  assert.equal(catalog.resolve('§ 99 StGB'), null)
  assert.equal(catalog.resolve('Diebstahl'), null)
  assert.equal(catalog.find('stgb:p9')?.penal, true)
  assert.equal(catalog.find('stpo:p9')?.penal, false)
})

test('Straftatbestände: nur Normen aus dem Gesetzbuch, ohne Doppelte', async () => {
  const catalog = buildCatalog(book(), 'fallback')
  const charges = await normalizeCharges(['§ 9 StGB', { ref: 'stgb:p9' }, 'stgb:p13', 'erfunden:p1', 42], catalog)
  assert.deepEqual(charges, [
    { ref: 'stgb:p9', label: '§ 9 StGB', title: 'Diebstahl' },
    { ref: 'stgb:p13', label: '§ 13 StGB', title: 'Unterlassene Hilfeleistung' },
  ])
  assert.deepEqual(await normalizeCharges([], catalog), [])
  assert.deepEqual(readCharges([{ ref: 'a', label: 'X' }, { ref: 'a', label: 'X' }, { label: 'ohne ref' }, 'x']), [{ ref: 'a', label: 'X', title: '' }])
  assert.equal(chargeLine(charges[0]), '§ 9 StGB – Diebstahl')
  assert.deepEqual(mergeCharges([charges[0]], charges).map((charge) => charge.ref), ['stgb:p9', 'stgb:p13'])
})

test('Razzia-Antrag: Tatvorwürfe je Zeile werden zur Aufzählung', () => {
  const request = { ...emptyRaidRequest('Max Muster'), target: 'Anwesen', offenses: '§ 9 StGB – Diebstahl\n§ 4 BtMG – Unerlaubter Umgang', facts: 'Sachverhalt.' }
  const doc = raidDocument(request, { reference: 'R', createdAt: new Date('2026-11-14'), attachments: [] })
  const offenses = doc.sections.find((section) => section.heading === 'III. Tatvorwurf')!
  assert.deepEqual(offenses.list, ['§ 9 StGB – Diebstahl', '§ 4 BtMG – Unerlaubter Umgang'])
  const prose = raidDocument({ ...request, offenses: 'Diebstahl in mehreren Fällen.' }, { reference: 'R', createdAt: new Date(), attachments: [] })
  assert.equal(prose.sections.find((section) => section.heading === 'III. Tatvorwurf')!.list, undefined)
})

test('KI: Gesetzbuch im Prompt, Straftatbestände und mehrere Einträge in der Antwort', () => {
  assert.match(buildSystemPrompt('investigation'), /"entries"/)
  assert.match(buildSystemPrompt('investigation'), /Kennung aus dem Abschnitt „Gesetzbuch“/)
  assert.match(buildSystemPrompt('entries', 'report'), /Teile ihn in Chronologie-Einträge auf/)
  assert.doesNotMatch(buildSystemPrompt('entry'), /Gesetzbuch/)
  assert.match(buildSystemPrompt('entry', 'message'), /"charges"/)

  const prompt = buildUserPrompt({ kind: 'entries', source: 'report', keywords: 'Bericht', laws: 'stgb:p9 = § 9 StGB Diebstahl', existingCharges: ['stgb:p9 (§ 9 StGB)'] })
  assert.ok(prompt.includes('## Gesetzbuch (FJD)'))
  assert.ok(prompt.includes('Schon in der Akte: stgb:p9'))
  assert.ok(prompt.indexOf('## Gesetzbuch') < prompt.indexOf('## Bericht des Agents'))

  const suggestion = parseSuggestion('{"title":"T","content":"C","entries":[{"title":"A","content":"B","kind":"evidence"},{"title":"","content":"x"}],"charges":["stgb:p9",3]}')
  assert.deepEqual(suggestion.entries, [{ title: 'A', content: 'B', kind: 'EVIDENCE' }])
  assert.deepEqual(suggestion.charges, ['stgb:p9'])

  assert.throws(() => parseEntriesPlan('{"entries":[]}'), /keine Einträge/)
  assert.equal(parseEntriesPlan('{"entries":[{"title":"A","content":"B","kind":"UNBEKANNT"}]}').entries[0].kind, 'NOTE')
  assert.deepEqual(readChanges({ charges: ['stgb:p9', ''] }).charges, ['stgb:p9'])
  assert.equal(readDraftEntries(Array.from({ length: 20 }, () => ({ title: 'a', content: 'b' }))).length, 12)
})

test('A4-Seiten: lange Texte werden an Satzgrenzen geteilt', () => {
  const text = `${'Ein Satz. '.repeat(150)}\n\nZweiter Absatz.`
  const parts = splitText(text, 300)
  assert.ok(parts.length > 3)
  assert.ok(parts.every((part) => part.length <= 300))
  assert.equal(parts.at(-1), 'Zweiter Absatz.')
  assert.deepEqual(splitText(''), [])
})
