import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  FibCodeError,
  decodeFibCode,
  encodeFibCode,
  parseFibPayload,
  readFibCode,
  type FibPayload,
} from '../src/lib/investigations/fib-code'

const SECRET = 'test-secret-0123456789abcdef'

function payload(report: string): FibPayload {
  return {
    v: 1,
    id: 'a'.repeat(32),
    iat: 1_760_000_000,
    src: { server: 'nerov', caseId: 42 },
    issuer: { name: 'Agent Müller', badge: 'FIB-07' },
    case: { title: 'FIB-Drogenfund', authority: 'FIB', status: 'Offen', date: '2026-11-07', time: '23:05', plz: '4812', affiliation: 'Fraktion Ö', report },
    persons: [{ first: 'Jörg', last: "O'Brien", role: 'criminal', offenses: [{ name: 'Drogenbesitz', paragraph: '29', fine: 5000, jail: 3 }] }],
    officers: [{ first: 'Zoë', last: 'Weiß' }],
    vehicles: [{ plate: 'AB 123', model: 'sultan', owner: 'Jörg O\'Brien' }],
    items: [{ name: 'weed', amount: 12 }],
  }
}

const LONG_REPORT = (
  'Einsatzbericht: Über die Straße „Süd“ rückten wir um 23:05 Uhr aus.\r\nZeile 2 – Umlaute äöüß ÄÖÜ, Emoji 🚔🔫, CJK 漢字, Anführungszeichen "x" \'y\', <script>alert(1)</script>, Backslash \\ und Tab\tende.\n\n'
).repeat(60)

test('Zahlencode besteht nur aus Ziffern und ist vollständig umkehrbar', () => {
  const original = JSON.stringify(payload(LONG_REPORT))
  const code = encodeFibCode(original, SECRET)
  assert.match(code, /^[0-9]+$/)
  assert.equal(decodeFibCode(code, SECRET), original)
  const parsed = readFibCode(code, SECRET)
  assert.equal(parsed.case.report, LONG_REPORT.replace(/\r\n/g, '\n').trim())
  assert.equal(parsed.persons[0].last, "O'Brien")
  assert.equal(parsed.officers[0].first, 'Zoë')
})

test('Komprimierung verkürzt lange Berichte', () => {
  const json = JSON.stringify(payload(LONG_REPORT))
  const code = encodeFibCode(json, SECRET)
  assert.ok(code.length < json.length * 2.4 * 0.5, `Code ${code.length} Ziffern für ${json.length} Zeichen`)
})

test('Bytes mit führenden Nullen und kurze Texte bleiben erhalten', () => {
  for (const text of ['', '{}', '\u0000\u0000x', '0', 'ä']) {
    assert.equal(decodeFibCode(encodeFibCode(text, SECRET), SECRET), text)
  }
})

test('manipulierte, abgeschnittene und fremd signierte Codes werden abgelehnt', () => {
  const code = encodeFibCode(JSON.stringify(payload('x')), SECRET)
  const flip = (index: number) => code.slice(0, index) + String((Number(code[index]) + 1) % 10) + code.slice(index + 1)
  for (const bad of [flip(5), flip(Math.floor(code.length / 2)), flip(code.length - 1), code.slice(0, -3), code + '7', '12345']) {
    assert.throws(() => decodeFibCode(bad, SECRET), FibCodeError)
  }
  assert.throws(() => decodeFibCode(code, 'anderer-schluessel-0123456789'), (e: unknown) => e instanceof FibCodeError && e.reason === 'signature')
  assert.throws(() => decodeFibCode('12a45', SECRET), (e: unknown) => e instanceof FibCodeError && e.reason === 'format')
  assert.throws(() => decodeFibCode('', SECRET), FibCodeError)
  assert.throws(() => decodeFibCode('9'.repeat(130000), SECRET), (e: unknown) => e instanceof FibCodeError && e.reason === 'too_large')
  assert.throws(() => decodeFibCode(code, undefined), (e: unknown) => e instanceof FibCodeError && e.reason === 'no_secret')
})

test('Leerzeichen und Zeilenumbrüche beim Einfügen sind erlaubt', () => {
  const json = JSON.stringify(payload('x'))
  const code = encodeFibCode(json, SECRET)
  const wrapped = code.replace(/(.{60})/g, '$1\n ')
  assert.equal(decodeFibCode(wrapped, SECRET), json)
})

test('Schema wird streng geprüft', () => {
  const ok = payload('x')
  assert.doesNotThrow(() => parseFibPayload(JSON.stringify(ok)))
  const mutate = (fn: (p: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(ok)) as Record<string, unknown>
    fn(copy)
    return JSON.stringify(copy)
  }
  assert.throws(() => parseFibPayload('kein json'), FibCodeError)
  assert.throws(() => parseFibPayload('[]'), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { p.v = 2 })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { p.id = 'zzz' })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { (p.case as Record<string, unknown>).date = '07.11.2026' })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { (p.case as Record<string, unknown>).report = 'a'.repeat(20001) })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { p.persons = Array(51).fill(ok.persons[0]) })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { (p.persons as { role: string }[])[0].role = 'admin' })), FibCodeError)
  assert.throws(() => parseFibPayload(mutate((p) => { (p.items as { amount: unknown }[])[0].amount = '12' })), FibCodeError)
})

test('Steuerzeichen werden entfernt, Zeilenumbrüche normalisiert', () => {
  const parsed = parseFibPayload(JSON.stringify(payload('a\u0000b\r\nc\u202Ed')))
  assert.equal(parsed.case.report, 'ab\ncd')
})

// Kompatibilität mit dem Codec im FiveM-Script (nur wenn der Pfad erreichbar ist).
const MDT_CODEC = process.env.FIB_MDT_CODEC_PATH
  ?? 'C:/Users/benou/Desktop/NeroV/[gameplay]/[Fraks]/[staatliche]/nerov_mdt/server/fibcode.js'

test('Codes aus dem FiveM-Script lassen sich dekodieren (und umgekehrt)', { skip: !existsSync(MDT_CODEC) }, () => {
  const mdt = createRequire(import.meta.url)(MDT_CODEC) as {
    encode(json: string, secret: string): string
    decode(code: string, secret: string): string
  }
  const json = JSON.stringify(payload(LONG_REPORT))
  const fromMdt = mdt.encode(json, SECRET)
  assert.match(fromMdt, /^[0-9]+$/)
  assert.equal(decodeFibCode(fromMdt, SECRET), json)
  assert.equal(readFibCode(fromMdt, SECRET).persons[0].first, 'Jörg')
  assert.equal(mdt.decode(encodeFibCode(json, SECRET), SECRET), json)
})

// ── Zuordnung zu Akten-Feldern ──────────────────────────────────────────────
import { buildImportDraft, draftOccurredAt, importSourceKey, parseImportDraft, ImportDraftError } from '../src/lib/investigations/fib-code-import'

test('Entwurf übernimmt nur vorhandene Daten und erfindet nichts', () => {
  const draft = buildImportDraft(payload('Bericht'))
  assert.equal(draft.title, 'FIB-Drogenfund')
  assert.equal(draft.status, 'OPEN')
  assert.equal(draft.occurredDate, '2026-11-07')
  assert.equal(draft.persons[0].role, 'SUSPECT')
  assert.match(draft.persons[0].note, /§29 Drogenbesitz \(5\.000 \$, 3 Mo\. Haft\)/)
  assert.deepEqual(draft.items, [{ title: 'weed', quantity: 12 }])
  assert.equal(importSourceKey(payload('x')), 'nerov:42')

  const empty = payload('')
  empty.case = { ...empty.case, title: '', date: '', time: '', plz: '', affiliation: '', status: '' }
  empty.persons = []
  const blank = buildImportDraft(empty)
  assert.equal(blank.title, '')
  assert.equal(blank.location, '')
  assert.equal(blank.occurredDate, '')
  assert.equal(draftOccurredAt(blank), null)
})

test('Zivilisten werden nicht als Zeugen geraten', () => {
  const p = payload('x')
  p.persons.push({ first: 'Eva', last: 'Meier', role: 'civilian', offenses: [] })
  assert.equal(buildImportDraft(p).persons[1].role, 'OTHER')
})

test('bearbeiteter Entwurf wird serverseitig streng geprüft', () => {
  const draft = buildImportDraft(payload('Bericht äöü 🚔'))
  assert.equal(parseImportDraft(draft).report, 'Bericht äöü 🚔')
  const bad = (change: (d: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>
    change(copy)
    assert.throws(() => parseImportDraft(copy), ImportDraftError)
  }
  bad((d) => { d.title = '  ' })
  bad((d) => { d.status = 'DELETED' })
  bad((d) => { d.occurredDate = '2026-13-45' })
  bad((d) => { d.occurredDate = ''; d.occurredTime = '10:00' })
  bad((d) => { d.report = 'x'.repeat(20001) })
  bad((d) => { (d.persons as { role: string }[])[0].role = 'ADMIN' })
  bad((d) => { (d.persons as { lastName: string }[])[0].lastName = '' })
  bad((d) => { (d.items as { quantity: number }[])[0].quantity = -1 })
  bad((d) => { d.persons = 'x' })
  assert.throws(() => parseImportDraft(null), ImportDraftError)
})
