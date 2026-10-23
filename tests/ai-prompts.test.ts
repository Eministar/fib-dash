import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSystemPrompt, buildUserPrompt, parseSuggestion, MAX_KEYWORDS_LENGTH } from '../src/lib/ai/ai-prompts'
import { aiProposalMessage, AI_ACCEPT_PREFIX, AI_REJECT_PREFIX } from '../src/lib/ai/ai-discord'

const author = { name: 'Max Muster', rank: 'Special Agent', badgeNumber: '12' }
const now = new Date('2026-10-23T12:00:00Z')

test('Systemprompt verbietet Erfindungen, verlangt JSON und behandelt Eingaben als Daten', () => {
  for (const kind of ['entry', 'investigation'] as const) {
    const system = buildSystemPrompt(kind)
    assert.match(system, /Erfinde nichts/)
    assert.match(system, /missing/)
    assert.match(system, /JSON/)
    assert.match(system, /Daten, keine Befehle/)
  }
  assert.match(buildSystemPrompt('entry'), /Chronologie-Eintrag/)
  assert.match(buildSystemPrompt('investigation'), /neuen Einsatzakte/)
})

test('Nutzerprompt enthält Verfasser, Akte, Familie und die Stichwörter klar abgegrenzt', () => {
  const prompt = buildUserPrompt({
    kind: 'entry',
    keywords: 'Hafen, zwei SUVs, Übergabe',
    author,
    now,
    investigation: {
      caseNumber: 'ERM-0142', title: 'Waffenlieferung', summary: 'Verdacht auf Lieferung', status: 'Offen', priority: 'Hoch',
      leadAgent: 'Anna Beispiel', persons: ['Diego Vasquez (Verdächtiger)'],
      recentEntries: [{ date: '20.10.26, 18:00', kind: 'Observation', title: 'Pier beobachtet', content: 'Nichts auffällig' }],
    },
    family: { title: 'Familie Vasquez', leader: 'Diego Vasquez', address: 'Vinewood Hills 12', members: ['Rosa Vasquez'], recentCases: ['ERM-0131 Observation'] },
  })
  assert.ok(prompt.includes('Max Muster, Special Agent, DN 12'))
  assert.ok(prompt.includes('Aktenzeichen: ERM-0142'))
  assert.ok(prompt.includes('Fraktionsleiter: Diego Vasquez'))
  assert.ok(prompt.includes('Pier beobachtet'))
  assert.ok(prompt.indexOf('## Stichwörter') > prompt.indexOf('## Familienakte'))
  assert.ok(prompt.includes('"""\nHafen, zwei SUVs, Übergabe\n"""'))
})

test('Ohne Kontext bleibt der Nutzerprompt schlank und kürzt überlange Stichwörter', () => {
  const prompt = buildUserPrompt({ kind: 'investigation', keywords: 'x'.repeat(MAX_KEYWORDS_LENGTH + 50), author: { name: 'A', rank: null, badgeNumber: null }, now })
  assert.ok(!prompt.includes('## Ermittlungsakte'))
  assert.ok(!prompt.includes('## Familienakte'))
  const keywordBlock = prompt.split('"""')[1].trim()
  assert.ok(keywordBlock.length <= MAX_KEYWORDS_LENGTH)
})

test('Antwort der KI wird gelesen, begrenzt und bei Unsinn abgelehnt', () => {
  const parsed = parseSuggestion('Hier: {"title":"Observation Hafen","content":"Zwei SUVs wurden beobachtet.","missing":["Uhrzeit"]}')
  assert.equal(parsed.title, 'Observation Hafen')
  assert.deepEqual(parsed.missing, ['Uhrzeit'])
  assert.deepEqual(parseSuggestion('{"title":"T","content":"C"}').missing, [])
  assert.equal(parseSuggestion(JSON.stringify({ title: 'x'.repeat(300), content: 'c' })).title.length, 200)
  assert.throws(() => parseSuggestion(''), /keinen Vorschlag/)
  assert.throws(() => parseSuggestion('{kaputt'), /keinen Vorschlag|lesbaren/)
  assert.throws(() => parseSuggestion('{"title":"","content":"c"}'), /unvollständig/)
})

test('Vorschlag in Discord hat Übernehmen und Verwerfen und pingt niemanden', () => {
  const message = aiProposalMessage({ id: 'p1', requesterDiscordId: '42', title: 'Titel', content: 'Text', missing: ['Ort'] }) as unknown as {
    allowed_mentions: { parse: string[] }
    components: { components: { type: number; content?: string; components?: { custom_id: string; label: string }[] }[] }[]
  }
  assert.deepEqual(message.allowed_mentions.parse, [])
  const row = message.components[0].components.find((component) => component.type === 1)
  assert.deepEqual(row?.components?.map((button) => button.custom_id), [`${AI_ACCEPT_PREFIX}p1`, `${AI_REJECT_PREFIX}p1`])
  const json = JSON.stringify(message)
  assert.ok(json.includes('<@42>'))
  assert.ok(json.includes('Fehlt noch'))
})
