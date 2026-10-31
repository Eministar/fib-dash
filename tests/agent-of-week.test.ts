import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateRatings,
  formatScore,
  isWeekKey,
  rankScores,
  ratingRejection,
  scoreBar,
  shiftWeekKey,
  weekKey,
  weekKeyLabel,
  weekWinners,
} from '../src/lib/agents/agent-of-week'
import { agentOfWeekBoardFingerprint, agentOfWeekBoardMessages, type BoardInput } from '../src/lib/agents/agent-of-week-board'

const rating = (agentId: string, shooting: number, work: number, activity: number, roleplay: number) => ({ agentId, shooting, work, activity, roleplay })

test('Wochenschlüssel richten sich nach deutscher Zeit und ISO-Wochen', () => {
  // So 01.11.2026 23:30 Berlin (MEZ) = 22:30 UTC – noch KW 44.
  assert.equal(weekKey(new Date('2026-11-01T22:30:00Z')), '2026-W44')
  // Mo 02.11.2026 00:30 Berlin = So 23:30 UTC – schon KW 45.
  assert.equal(weekKey(new Date('2026-11-01T23:30:00Z')), '2026-W45')
  // 01.01.2027 ist ein Freitag und gehört zur KW 53 von 2026.
  assert.equal(weekKey(new Date('2027-01-01T12:00:00Z')), '2026-W53')
  assert.equal(shiftWeekKey('2026-W53', 1), '2027-W01')
  assert.equal(shiftWeekKey('2027-W01', -1), '2026-W53')
  assert.equal(shiftWeekKey('2026-W44', -4), '2026-W40')
  assert.equal(weekKeyLabel('2026-W44'), 'KW 44 · 26.10.–01.11.2026')
  assert.ok(isWeekKey('2026-W44'))
  assert.ok(!isWeekKey('2026-W54'))
  assert.ok(!isWeekKey('2026-44'))
})

test('Gesamt ist das Mittel der vier Kategorie-Mittel', () => {
  const [score] = aggregateRatings([rating('a', 10, 8, 6, 4), rating('a', 8, 8, 8, 8)])
  assert.equal(score.ratingCount, 2)
  assert.equal(score.shooting, 9)
  assert.equal(score.roleplay, 6)
  assert.equal(score.overall, (9 + 8 + 7 + 6) / 4)
})

test('Wenige Bewertungen reichen nicht für den Titel', () => {
  const ranked = rankScores(aggregateRatings([
    rating('solo', 10, 10, 10, 10),
    ...Array.from({ length: 4 }, () => rating('busy', 9, 9, 9, 9)),
    ...Array.from({ length: 2 }, () => rating('half', 7, 7, 7, 7)),
  ]))
  assert.deepEqual(ranked.map((row) => [row.agentId, row.place, row.qualified]), [
    ['busy', 1, true],
    ['half', 2, true],
    ['solo', 3, false],
  ])
  assert.deepEqual(weekWinners(ranked).map((row) => row.agentId), ['busy'])
})

test('Gleichstand teilt Platz und Titel', () => {
  const ranked = rankScores(aggregateRatings([rating('a', 8, 8, 8, 8), rating('b', 8, 8, 8, 8), rating('c', 5, 5, 5, 5)]))
  assert.deepEqual(ranked.map((row) => row.place), [1, 1, 3])
  assert.deepEqual(weekWinners(ranked).map((row) => row.agentId).sort(), ['a', 'b'])
  assert.deepEqual(weekWinners([]), [])
})

test('Bewerten: nur mit eigenem Agent, nicht sich selbst, keine Beurlaubten', () => {
  assert.match(ratingRejection({ raterAgentId: null, agentId: 'a', agentStatus: 'ACTIVE' }) ?? '', /verknüpftem Agent/)
  assert.match(ratingRejection({ raterAgentId: 'a', agentId: 'a', agentStatus: 'ACTIVE' }) ?? '', /selbst/)
  assert.ok(ratingRejection({ raterAgentId: 'a', agentId: 'b', agentStatus: 'ON_LEAVE' }))
  assert.ok(ratingRejection({ raterAgentId: 'a', agentId: 'b', agentStatus: 'TERMINATED' }))
  assert.equal(ratingRejection({ raterAgentId: 'a', agentId: 'b', agentStatus: 'AWAY' }), null)
})

test('Balken und Zahlen im deutschen Format', () => {
  assert.equal(scoreBar(8.4), '▰▰▰▰▰▰▰▰▱▱')
  assert.equal(scoreBar(10), '▰▰▰▰▰▰▰▰▰▰')
  assert.equal(scoreBar(1), '▰▱▱▱▱▱▱▱▱▱')
  assert.equal(formatScore(8.66), '8,7')
  assert.equal(formatScore(9), '9,0')
})

type Component = { type: number; content?: string; components?: Component[]; accent_color?: number }

function countComponents(list: Component[]): number {
  return list.reduce((sum, item) => sum + 1 + countComponents(item.components ?? []), 0)
}

function text(list: Component[]): string {
  return list.map((item) => (item.content ?? '') + text(item.components ?? [])).join('\n')
}

function boardInput(agents: number): BoardInput {
  const scores = { shooting: 9, work: 8, activity: 7, roleplay: 6, overall: 7.5, ratingCount: 4 }
  return {
    week: '2026-W45',
    raterCount: 4,
    ranking: Array.from({ length: agents }, (_, index) => ({ ...scores, firstName: 'Max', lastName: `Mustermann${index}`, badgeNumber: String(100 + index), place: index + 1, qualified: true })),
    winners: { week: '2026-W44', agents: [{ ...scores, firstName: 'Lisa', lastName: 'Brandt', badgeNumber: '214' }] },
    url: 'https://example.test/agent-der-woche',
  }
}

test('Board: goldene Siegerkarte, mehrere Agents je Karte, Link unten', () => {
  const [message, ...rest] = agentOfWeekBoardMessages(boardInput(5))
  assert.equal(rest.length, 0)
  const cards = message.components as Component[]
  assert.equal(cards.length, 3)
  assert.equal(cards[0].accent_color, 0xf0b232)
  assert.match(text([cards[0]]), /Agent der Woche[\s\S]*Lisa Brandt[\s\S]*Schießen ▰/)
  assert.match(text([cards[1]]), /Ranking KW 45 · Plätze 1–3/)
  assert.match(text([cards[2]]), /Plätze 4–5[\s\S]*Schießen · .*Allgemeine Arbeit/)
  assert.equal(cards[2].components?.at(-1)?.type, 1)
})

test('Board: viele Agents verteilen sich auf mehrere Nachrichten innerhalb der Discord-Limits', () => {
  const messages = agentOfWeekBoardMessages(boardInput(60))
  assert.ok(messages.length > 1)
  for (const message of messages) {
    assert.ok(countComponents(message.components as Component[]) <= 40)
    assert.ok(text(message.components as Component[]).length <= 4000)
  }
  const all = messages.map((message) => text(message.components as Component[])).join('\n')
  assert.match(all, /Mustermann59/)
})

test('Board: Leerzustände und stabiler Fingerabdruck ohne Zeitstempel', () => {
  const empty = agentOfWeekBoardMessages({ week: '2026-W45', raterCount: 0, ranking: [], winners: null })
  const content = text(empty[0].components as Component[])
  assert.match(content, /Noch kein Titel vergeben/)
  assert.match(content, /noch keine Bewertungen/)
  const input = boardInput(2)
  assert.equal(agentOfWeekBoardFingerprint(input, '1'), agentOfWeekBoardFingerprint(input, '1'))
  assert.notEqual(agentOfWeekBoardFingerprint(input, '1'), agentOfWeekBoardFingerprint({ ...input, raterCount: 5 }, '1'))
})
