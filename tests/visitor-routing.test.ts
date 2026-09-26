/**
 * Wohin ein Nutzer ohne Dashboard-Rechte geschickt wird.
 *
 * Der Regressionsfall steht ganz unten: solange die Bodycam-Frage noch nicht
 * beantwortet ist, darf NICHT umgeleitet werden. `useFetch` meldet in genau
 * einem Render `loading === false`, obwohl es nie gefragt hat — wer darauf
 * baut, schiebt jeden Katalog-Leser ins Besucherportal.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { visitorRedirectTarget } from '../src/lib/visitor-routing'

const base = {
  visitorOnly: true,
  bodycam: 'denied' as const,
  isBodycamCatalog: false,
  isSharedFormTestLink: false,
}

test('Wer Dashboard-Rechte hat, wird nie umgeleitet', () => {
  assert.equal(visitorRedirectTarget({ ...base, visitorOnly: false }), null)
  assert.equal(visitorRedirectTarget({ ...base, visitorOnly: false, bodycam: 'pending' }), null)
})

test('Ohne Rechte und ohne Katalogzugriff geht es ins Besucherportal', () => {
  assert.equal(visitorRedirectTarget(base), '/besucherportal')
})

test('Ein geteilter Testlink bleibt offen', () => {
  assert.equal(visitorRedirectTarget({ ...base, isSharedFormTestLink: true }), null)
})

test('Ein Katalog-Leser landet im Bodycam-Katalog und bleibt dort', () => {
  assert.equal(visitorRedirectTarget({ ...base, bodycam: 'allowed' }), '/investigations/clips')
  assert.equal(
    visitorRedirectTarget({ ...base, bodycam: 'allowed', isBodycamCatalog: true }),
    null,
  )
})

test('Solange die Bodycam-Frage offen ist, wird NICHT umgeleitet', () => {
  // Der eigentliche Bug: hier stand vorher '/besucherportal', weil die
  // unbeantwortete Abfrage wie ein "nein" gewertet wurde.
  assert.equal(visitorRedirectTarget({ ...base, bodycam: 'pending' }), null)
  assert.equal(visitorRedirectTarget({ ...base, bodycam: 'pending', isBodycamCatalog: true }), null)
})
