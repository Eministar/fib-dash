import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentMatchScore, matchesAgent, matchesSearch, searchTokens } from '../src/lib/search-match'

const max = {
  firstName: 'Max',
  lastName: 'Müller',
  badgeNumber: 'FIB-07',
  discordId: null,
  user: { discordId: '284738291047382910', displayName: 'maxi' },
  rank: { name: 'Special Agent' },
}
const anna = { firstName: 'Anna', lastName: 'Schmidt', badgeNumber: '17', discordId: '112233445566778899', rank: { name: 'Detective' } }
const bert = { firstName: 'Bert', lastName: 'Klein', badgeNumber: '170', discordId: null, rank: { name: 'Detective' } }

test('Discord-ID: vollständig, als Teilstück, als Erwähnung, mit Leerzeichen, am Benutzerkonto', () => {
  assert.ok(matchesAgent('284738291047382910', max))
  assert.ok(matchesAgent('28473829', max))
  assert.ok(matchesAgent('<@284738291047382910>', max))
  assert.ok(matchesAgent('<@!284738291047382910>', max))
  assert.ok(matchesAgent(' 284738291047382910 ', max))
  assert.ok(matchesAgent('2847 3829 1047 3829 10', max))
  assert.ok(!matchesAgent('284738291047382910', anna))
})

test('Dienstnummer: führende Nullen und Präfix egal, keine Teiltreffer bei kurzen Zahlen', () => {
  assert.ok(matchesAgent('7', max))
  assert.ok(matchesAgent('07', max))
  assert.ok(matchesAgent('#7', max))
  assert.ok(matchesAgent('fib-07', max))
  assert.ok(!matchesAgent('7', anna))
  assert.ok(!matchesAgent('7', bert))
  assert.ok(matchesAgent('17', anna))
  assert.ok(!matchesAgent('17', bert))
})

test('Namen: voller Name, umgekehrt, Umlaute, Groß/Klein, gemischt mit Nummer', () => {
  assert.ok(matchesAgent('Max Müller', max))
  assert.ok(matchesAgent('müller max', max))
  assert.ok(matchesAgent('mueller', max))
  assert.ok(matchesAgent('müller', { ...max, lastName: 'Mueller' }))
  assert.ok(matchesAgent('MULLER', max))
  assert.ok(matchesAgent('max 7', max))
  assert.ok(!matchesAgent('max 17', max))
  assert.ok(matchesAgent('detective schmidt', anna))
  assert.ok(matchesAgent('maxi', max))
})

test('Leere Suche passt immer, Satzzeichen stören nicht', () => {
  assert.ok(matchesSearch('', ['x']))
  assert.ok(matchesSearch('   ', []))
  assert.deepEqual(searchTokens('Max, Müller;'), ['max', 'muller'])
})

test('Relevanz: exakte ID vor Dienstnummer vor Namensanfang', () => {
  assert.ok(agentMatchScore('284738291047382910', max) > agentMatchScore('7', max))
  assert.ok(agentMatchScore('7', max) > agentMatchScore('ma', max))
})
