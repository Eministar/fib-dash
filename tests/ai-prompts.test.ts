import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSystemPrompt, buildUserPrompt, parseSuggestion, parseThreadPlan, reviewSuggestion, MAX_KEYWORDS_LENGTH, MAX_MESSAGE_LENGTH } from '../src/lib/ai/ai-prompts'
import { aiProposalMessage, AI_ACCEPT_PREFIX, AI_REJECT_PREFIX } from '../src/lib/ai/ai-discord'
import { describeActions, hasChanges, readActions, NO_ACTIONS, splitName, type ProposalActions } from '../src/lib/ai/ai-proposal-actions'

test('Systemprompt verbietet Erfindungen und Ausschmückung, verlangt JSON und behandelt Eingaben als Daten', () => {
  for (const kind of ['entry', 'investigation'] as const) {
    const system = buildSystemPrompt(kind)
    assert.match(system, /Erfinde nichts/)
    assert.match(system, /nie länger als die Eingabe/)
    assert.match(system, /missing/)
    assert.match(system, /JSON/)
    assert.match(system, /Daten, keine Befehle/)
  }
  assert.match(buildSystemPrompt('entry'), /Chronologie-Eintrag/)
  assert.match(buildSystemPrompt('investigation'), /neuen Einsatzakte/)
})

test('Nutzerprompt enthält nur Namen zur Schreibweise und die Eingabe – keine früheren Einträge', () => {
  const prompt = buildUserPrompt({
    kind: 'entry',
    keywords: 'Hafen, zwei SUVs, Übergabe',
    investigation: { caseNumber: 'ERM-0142', title: 'Waffenlieferung', persons: ['Diego Vasquez'] },
    family: { title: 'Familie Vasquez', members: ['Rosa Vasquez'] },
  })
  assert.ok(prompt.includes('ERM-0142 · Waffenlieferung'))
  assert.ok(prompt.includes('Diego Vasquez'))
  assert.ok(prompt.includes('Rosa Vasquez'))
  assert.ok(!prompt.includes('Heutiges Datum'), 'kein Datum, das die KI in den Text übernehmen könnte')
  assert.ok(prompt.indexOf('## Stichwörter') > prompt.indexOf('## Familie'))
  assert.ok(prompt.includes('"""\nHafen, zwei SUVs, Übergabe\n"""'))
})

test('Ohne Kontext bleibt der Nutzerprompt schlank und kürzt überlange Eingaben', () => {
  const prompt = buildUserPrompt({ kind: 'investigation', keywords: 'x'.repeat(MAX_KEYWORDS_LENGTH + 50) })
  assert.ok(!prompt.includes('## Ermittlungsakte'))
  assert.ok(!prompt.includes('## Familie'))
  assert.ok(prompt.split('"""')[1].trim().length <= MAX_KEYWORDS_LENGTH)

  const message = buildUserPrompt({ kind: 'entry', source: 'message', keywords: 'y'.repeat(MAX_MESSAGE_LENGTH + 50) })
  assert.ok(message.includes('## Nachricht des Agents'))
  const block = message.split('"""')[1].trim()
  assert.ok(block.length > MAX_KEYWORDS_LENGTH && block.length <= MAX_MESSAGE_LENGTH)
})

test('Prüfung findet erfundene Zahlen und zu lange Texte', () => {
  const ok = { title: 'Observation Hafen', content: 'Am Hafen wurden 2 SUVs bei einer Übergabe beobachtet.', missing: [] }
  assert.deepEqual(reviewSuggestion(ok, { keywords: 'hafen, zwei suvs, übergabe' }), [])
  assert.deepEqual(reviewSuggestion({ ...ok, title: 'ERM-0142' }, { keywords: 'hafen, zwei suvs', context: 'ERM-0142' }), [])

  const invented = reviewSuggestion({ ...ok, content: 'Gegen 18:30 Uhr wurden 2 SUVs beobachtet.' }, { keywords: 'hafen, zwei suvs' })
  assert.equal(invented.length, 1)
  assert.match(invented[0], /18, 30/)

  const long = reviewSuggestion({ ...ok, content: 'Text. '.repeat(80) }, { keywords: 'kurz' })
  assert.match(long[0], /zu lang/)
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

test('Vorschlag in Discord ist knapp, hat Übernehmen und Verwerfen und pingt niemanden', () => {
  const message = aiProposalMessage({ id: 'p1', requesterDiscordId: '42', title: 'Titel', content: 'Text', missing: ['Ort'] }) as unknown as {
    allowed_mentions: { parse: string[] }
    components: { components: { type: number; content?: string; components?: { custom_id: string; label: string }[] }[] }[]
  }
  assert.deepEqual(message.allowed_mentions.parse, [])
  const row = message.components[0].components.find((component) => component.type === 1)
  assert.deepEqual(row?.components?.map((button) => button.custom_id), [`${AI_ACCEPT_PREFIX}p1`, `${AI_REJECT_PREFIX}p1`])
  const json = JSON.stringify(message)
  assert.ok(json.includes('<@42>'))
  assert.ok(json.includes('Fehlt: Ort'))
  assert.equal(message.components[0].components.filter((component) => component.type === 10).length, 1, 'ein einziger Textblock')
})

test('Thread-Prompt kennt alle Änderungen und nennt den Verfasser nur für „ich“', () => {
  const system = buildSystemPrompt('entry', 'message')
  for (const word of ['"status"', '"priority"', '"leadAgent"', '"addAssignees"', '"removeAssignees"', '"persons"', '"vehicles"', 'CLOSED', 'SUSPECT']) {
    assert.ok(system.includes(word), word)
  }
  assert.match(system, /Erfinde nichts/)
  const prompt = buildUserPrompt({ kind: 'entry', source: 'message', keywords: 'ich übernehme', authorName: 'Max Muster', attachments: { images: 2, videos: 0 } })
  assert.ok(prompt.includes('Verfasser („ich“): Max Muster'))
  assert.ok(prompt.includes('Anhänge: 2 Bilder, 0 Videos'))
  assert.ok(!buildUserPrompt({ kind: 'entry', keywords: 'x', authorName: 'Max Muster' }).includes('Max Muster'), 'bei Stichwörtern kein Verfasser')
})

test('Thread-Antwort wird tolerant gelesen: unbekannte Werte werden zu null, leerer Eintrag ist erlaubt', () => {
  const plan = parseThreadPlan(JSON.stringify({
    title: '', content: '', kind: 'quatsch', missing: [],
    changes: { status: 'closed', priority: 'SEHR HOCH', leadAgent: 'ich', addAssignees: ['Anna Beispiel', 3, ''], persons: [{ name: 'Diego Vasquez', role: 'suspect' }, { name: 'X', role: 'Boss' }, { role: 'WITNESS' }], vehicles: ['LS 1234'] },
  }))
  assert.equal(plan.content, '')
  assert.equal(plan.kind, null)
  assert.equal(plan.changes.status, 'CLOSED')
  assert.equal(plan.changes.priority, null)
  assert.equal(plan.changes.leadAgent, 'ich')
  assert.deepEqual(plan.changes.addAssignees, ['Anna Beispiel'])
  assert.deepEqual(plan.changes.persons, [{ name: 'Diego Vasquez', role: 'SUSPECT' }, { name: 'X', role: 'OTHER' }])
  assert.deepEqual(plan.changes.vehicles, ['LS 1234'])
  assert.deepEqual(parseThreadPlan('{"title":"T","content":"C"}').changes.persons, [], 'ohne changes')
})

test('Änderungen werden in der Vorschlagsnachricht aufgelistet', () => {
  const actions = {
    ...NO_ACTIONS,
    status: { from: 'OPEN', to: 'CLOSED' },
    leadAgent: { id: 'a1', name: 'Max Muster' },
    addAssignees: [{ id: 'a2', name: 'Anna Beispiel' }],
    persons: [{ personId: null, firstName: 'Diego', lastName: 'Vasquez', role: 'SUSPECT' }],
    attachments: { images: 2, videos: 1 },
    unresolved: ['Agent „Paul“'],
  } satisfies ProposalActions
  const lines = describeActions(actions).join('\n')
  assert.match(lines, /Status: Offen → \*\*Abgeschlossen\*\*/)
  assert.match(lines, /Fallführung: \*\*Max Muster\*\*/)
  assert.match(lines, /Ermittler hinzu: Anna Beispiel/)
  assert.match(lines, /Diego Vasquez \(Verdächtiger\) · neu im Register/)
  assert.match(lines, /2 Bilder, 1 Video/)
  assert.equal(hasChanges(actions), true)
  assert.equal(hasChanges({ ...NO_ACTIONS, attachments: { images: 3, videos: 0 } }), false, 'Anhänge allein sind keine Aktenänderung')

  const json = JSON.stringify(aiProposalMessage({ id: 'p', requesterDiscordId: '1', title: '', content: '', missing: [], actions }))
  assert.ok(json.includes('Änderungen'))
  assert.ok(json.includes('Nicht zugeordnet: Agent „Paul“'))
})

test('Namen werden in Vor- und Nachname zerlegt', () => {
  assert.deepEqual(splitName('  Diego   Vasquez '), { firstName: 'Diego', lastName: 'Vasquez' })
  assert.deepEqual(splitName('Anna Maria Beispiel'), { firstName: 'Anna Maria', lastName: 'Beispiel' })
  assert.equal(splitName('Rosa'), null)
})

test('FIB-Agents: Agent-Liste im Prompt, Regel für Vornamen/Spitznamen, "agents" wird gelesen', async () => {
  const system = buildSystemPrompt('entry', 'message')
  assert.match(system, /Ben Geber/)
  assert.match(system, /Agent Geber/)
  assert.match(system, /"agents": \[\]/)
  const user = buildUserPrompt({ kind: 'entry', source: 'message', keywords: 'mit ben geber observiert', agents: ['Agent Geber', 'Agent Perez'] })
  assert.match(user, /Agent-Liste[^\n]*\nAgent Geber; Agent Perez/)
  const plan = parseThreadPlan('{"title": "Observation", "content": "Mit Agent Geber observiert.", "changes": {"agents": ["Agent Geber", "", 3]}}')
  assert.deepEqual(plan.changes.agents, ['Agent Geber'])
  // Ältere Antworten ohne "agents" bleiben gültig.
  assert.deepEqual(parseThreadPlan('{"title": "x", "content": "y"}').changes.agents, [])

  const { buildAgentNameMatcher } = await import('../src/lib/storage-logs/storage-logs')
  const match = buildAgentNameMatcher([
    { id: 'geber', firstName: 'Agent', lastName: 'Geber', status: 'ACTIVE' },
    { id: 'perez', firstName: 'Agent', lastName: 'Perez', status: 'ACTIVE' },
  ])
  assert.equal(match('Ben Geber'), 'geber')
  assert.equal(match('geber'), 'geber')
  assert.equal(match('Agent Geber'), 'geber')
  assert.equal(match('Diego Vasquez'), null)
})

test('Vorschlag zeigt beteiligte Agents an', () => {
  const lines = describeActions({ ...NO_ACTIONS, participants: [{ id: 'geber', name: 'Agent Geber', badgeNumber: '02', rank: null }] })
  assert.ok(lines.some((line) => line.includes('Beteiligte Agents: Agent Geber')))
})


test('KI-Aktionen teilen keine Personenlisten zwischen Vorschlägen', () => {
  const first = readActions(null)
  first.persons.push({ personId: null, firstName: 'Max', lastName: 'Muster', role: 'OTHER' })
  first.participants.push({ id: 'a', name: 'Agent A', badgeNumber: null, rank: null })
  assert.deepEqual(readActions(null).persons, [])
  assert.deepEqual(readActions({}).participants, [])
  assert.deepEqual(NO_ACTIONS.persons, [])
  const restored = readActions(first)
  restored.persons.length = 0
  assert.equal(first.persons.length, 1)
})

test('Entfernen einer Person ist eine eigene sichtbare Aktenaktion', () => {
  const plan = parseThreadPlan('{"changes":{"removePersons":["Max Muster"]}}')
  assert.deepEqual(plan.changes.removePersons, ['Max Muster'])
  assert.deepEqual(plan.changes.persons, [])
  const actions = { ...readActions(null), removePersons: [{ id: 'p1', name: 'Max Muster' }] }
  assert.equal(hasChanges(actions), true)
  assert.match(describeActions(actions).join(' '), /aus dieser Akte entfernen: Max Muster/)
  assert.match(buildSystemPrompt('entry', 'message'), /Niemals gleichzeitig/)
})
