import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GameReminderTracker, trackedGameName } from '../src/lib/game-presence'

test('erkennt FiveM, GTA V with Medal und NERO-V ROLEPLAY unabhängig von Groß-/Kleinschreibung', () => {
  assert.equal(trackedGameName([{ name: 'FiveM' }]), 'FiveM')
  assert.equal(trackedGameName([{ name: 'GTA V with Medal' }]), 'GTA V with Medal')
  assert.equal(trackedGameName([{ name: 'fivem', details: 'NERO-V ROLEPLAY | discord.gg/nero' }]), 'fivem')
  assert.equal(trackedGameName([{ name: 'Grand Theft Auto V', type: 0, state: 'nero-v roleplay' }]), 'Grand Theft Auto V')
})

test('ignoriert andere Spiele und leere Aktivitäten', () => {
  assert.equal(trackedGameName([]), null)
  assert.equal(trackedGameName(undefined), null)
  assert.equal(trackedGameName([{ name: 'Spotify', details: 'FiveM Soundtrack', type: 2 }]), null)
  assert.equal(trackedGameName([{ name: 'Custom Status', state: 'gleich FiveM', type: 4 }]), null)
  assert.equal(trackedGameName([{ name: 'Minecraft' }, { name: 'Grand Theft Auto V' }]), null)
})

test('erinnert nur beim Spielstart, nicht bei jeder Statusänderung', () => {
  const tracker = new GameReminderTracker(60 * 60_000)
  const t0 = 1_000_000
  assert.equal(tracker.update('u', true, t0), true)
  assert.equal(tracker.update('u', true, t0 + 1000), false)
  assert.equal(tracker.update('u', false, t0 + 2000), false)
})

test('höchstens eine Erinnerung pro Stunde, auch bei Neustart des Spiels', () => {
  const tracker = new GameReminderTracker(60 * 60_000)
  const t0 = 1_000_000
  assert.equal(tracker.update('u', true, t0), true)
  tracker.update('u', false, t0 + 60_000)
  assert.equal(tracker.update('u', true, t0 + 5 * 60_000), false)
  tracker.update('u', false, t0 + 50 * 60_000)
  assert.equal(tracker.update('u', true, t0 + 61 * 60_000), true)
})

test('beim Verbindungsaufbau bereits laufende Spiele lösen keine Erinnerung aus', () => {
  const tracker = new GameReminderTracker(60 * 60_000)
  tracker.seed('u', true)
  assert.equal(tracker.update('u', true, 1_000), false)
  tracker.update('u', false, 2_000)
  assert.equal(tracker.update('u', true, 3_000), true)
})
