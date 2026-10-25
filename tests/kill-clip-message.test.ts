import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeDiscord, killClipMessage } from '../src/lib/discord/kill-clip-message'

const startedAt = new Date('2026-10-25T00:59:46Z')

test('Kill-Clip-Nachricht: Überschrift, Agent, Discord-Zeitstempel und Namen', () => {
  const text = killClipMessage({
    agentName: 'Agent Perez',
    badge: '01',
    startedAt,
    endedAt: new Date('2026-10-25T01:00:30Z'),
    kills: 2,
    victims: ['NV | Aki | FIB [865]', 'Max_Muster'],
  })
  assert.match(text, /^# `🎯` Kill-Clip · 2 Kills$/m)
  assert.match(text, /`👤` › \*\*Agent Perez\*\* \(01\)/)
  const s = Math.floor(startedAt.getTime() / 1000)
  assert.ok(text.includes(`\`🕒\` › <t:${s}:D> · <t:${s}:T> – <t:${s + 44}:T> (<t:${s}:R>)`), text)
  // Namen bleiben lesbar, Markdown wird entschärft.
  assert.match(text, /`☠️` › NV \\\| Aki \\\| FIB \\\[865\\\] · Max\\_Muster/)
})

test('Ein Kill ohne Namen, mehrere Teile, viele Namen werden gekürzt', () => {
  const single = killClipMessage({ agentName: 'Agent Perez', badge: '01', startedAt, kills: 1 })
  assert.match(single, /1 Kill$/m)
  assert.doesNotMatch(single, /☠️/)
  assert.doesNotMatch(single, / – /)

  const part = killClipMessage({ agentName: 'A', badge: '1', startedAt, kills: 3, part: 2, parts: 3 })
  assert.match(part, /Teil 2\/3/)

  const many = killClipMessage({ agentName: 'A', badge: '1', startedAt, kills: 12, victims: Array.from({ length: 12 }, (_, i) => `Spieler${i}`) })
  assert.match(many, /und 2 weitere/)
})

test('Erwähnungen in Namen pingen niemanden', () => {
  assert.equal(escapeDiscord('@everyone'), '@​everyone')
})
