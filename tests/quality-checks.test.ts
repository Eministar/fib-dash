import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateOfficerStats,
  correctionError,
  entryBalance,
  qcCompleteSchema,
  qcEntrySchema,
  qcShareCovers,
  qcShareIsActive,
  qcShareSchema,
  suggestRating,
} from '../src/lib/quality-checks'
import { lspdConfig } from '../src/lib/lspd-hr-client-config'
import { readLspdSnapshot } from '../src/lib/lspd-officers'

const entries = [
  { id: 'a', kind: 'POSITIVE', correctsId: null },
  { id: 'b', kind: 'NEGATIVE', correctsId: null },
  { id: 'c', kind: 'POSITIVE', correctsId: 'b' }, // korrigiert b zu positiv
  { id: 'd', kind: 'NOTE', correctsId: null },
]

test('Bilanz: korrigierte Einträge zählen nicht, ihre Korrektur schon', () => {
  assert.deepEqual(entryBalance(entries), { positive: 2, negative: 0, notes: 1 })
  assert.equal(suggestRating(entryBalance(entries)), 'POSITIVE')
  assert.equal(suggestRating({ positive: 1, negative: 1, notes: 0 }), 'NEUTRAL')
  assert.equal(suggestRating({ positive: 0, negative: 2, notes: 0 }), 'NEGATIVE')
})

test('Korrekturen: nur auf eigene, noch nicht korrigierte Einträge', () => {
  assert.equal(correctionError(entries, undefined), null)
  assert.equal(correctionError(entries, 'a'), null)
  assert.match(correctionError(entries, 'b') ?? '', /bereits korrigiert/)
  assert.match(correctionError(entries, 'fremd') ?? '', /gehört nicht/)
})

test('Eingaben werden geprüft', () => {
  assert.equal(qcEntrySchema.safeParse({ kind: 'POSITIVE', text: '  ' }).success, false)
  assert.equal(qcEntrySchema.safeParse({ kind: 'CORRECTION', text: 'x' }).success, false)
  assert.equal(qcEntrySchema.safeParse({ kind: 'NOTE', text: 'x', occurredAt: new Date(Date.now() + 3_600_000).toISOString() }).success, false)
  assert.equal(qcCompleteSchema.safeParse({ rating: 'POSITIVE', summary: '' }).success, false)
  assert.equal(qcCompleteSchema.safeParse({ rating: 'POSITIVE', summary: 'Gut' }).success, true)
})

test('Freigabe: Bereich braucht passendes Ziel, Ablauf in der Zukunft', () => {
  assert.equal(qcShareSchema.safeParse({ title: 'x', scope: 'CHECK' }).success, false)
  assert.equal(qcShareSchema.safeParse({ title: 'x', scope: 'OFFICER', lspdOfficerId: 'o1' }).success, true)
  assert.equal(qcShareSchema.safeParse({ title: 'x', scope: 'ALL', expiresAt: '2000-01-01T00:00:00Z' }).success, false)
})

test('Freigabe deckt nur ihren Umfang ab und respektiert Ablauf/Deaktivierung', () => {
  const base = { checkId: null, lspdOfficerId: null, enabled: true, expiresAt: null }
  assert.equal(qcShareCovers({ ...base, scope: 'ALL' }, { lspdOfficerId: 'x' }), true)
  assert.equal(qcShareCovers({ ...base, scope: 'OFFICER', lspdOfficerId: 'o1' }, { lspdOfficerId: 'o1' }), true)
  assert.equal(qcShareCovers({ ...base, scope: 'OFFICER', lspdOfficerId: 'o1' }, { lspdOfficerId: 'o2' }), false)
  assert.equal(qcShareCovers({ ...base, scope: 'CHECK', checkId: 'c1' }, { lspdOfficerId: 'o1', checkId: 'c2' }), false)
  assert.equal(qcShareCovers({ ...base, scope: 'CHECK', checkId: 'c1' }, { lspdOfficerId: 'o1' }), false)
  assert.equal(qcShareCovers({ ...base, scope: 'FOO' }, { lspdOfficerId: 'o1' }), false)
  assert.equal(qcShareIsActive({ enabled: false, expiresAt: null }), false)
  assert.equal(qcShareIsActive({ enabled: true, expiresAt: new Date(Date.now() - 1000) }), false)
  assert.equal(qcShareIsActive({ enabled: true, expiresAt: new Date(Date.now() + 60_000) }), true)
})

test('Kennzahlen je Beamtem: Name aus der jüngsten Kontrolle', () => {
  const stats = aggregateOfficerStats([
    { lspdOfficerId: 'o1', officerName: 'Alt', officerBadge: '1', officerRank: 'Cadet', status: 'COMPLETED', rating: 'NEGATIVE', startedAt: new Date('2026-09-01') },
    { lspdOfficerId: 'o1', officerName: 'Neu', officerBadge: '1', officerRank: 'Officer', status: 'COMPLETED', rating: 'POSITIVE', startedAt: new Date('2026-09-10') },
    { lspdOfficerId: 'o1', officerName: 'Neu', officerBadge: '1', officerRank: 'Officer', status: 'RUNNING', rating: null, startedAt: new Date('2026-09-05') },
    { lspdOfficerId: 'o2', officerName: 'B', officerBadge: '2', officerRank: 'Officer', status: 'COMPLETED', rating: 'NEUTRAL', startedAt: new Date('2026-08-01') },
  ])
  assert.equal(stats.length, 2)
  assert.equal(stats[0].lspdOfficerId, 'o1')
  assert.equal(stats[0].name, 'Neu')
  assert.equal(stats[0].rank, 'Officer')
  assert.equal(stats[0].total, 3)
  assert.equal(stats[0].running, 1)
  assert.deepEqual(stats[0].ratings, { POSITIVE: 1, NEUTRAL: 0, NEGATIVE: 1 })
  assert.equal('latest' in stats[0], false)
})

test('LSPD-Konfiguration und Momentaufnahmen', () => {
  assert.equal(lspdConfig({} as NodeJS.ProcessEnv), null)
  assert.deepEqual(lspdConfig({ LSPD_HR_API_URL: 'https://lspd.example/', LSPD_HR_API_SECRET: 's' } as unknown as NodeJS.ProcessEnv), {
    url: 'https://lspd.example',
    secret: 's',
  })
  assert.equal(readLspdSnapshot({ name: 'x' }), null)
  assert.deepEqual(readLspdSnapshot({ id: 'o1', name: 'Max', badgeNumber: 12 }), { id: 'o1', name: 'Max', badgeNumber: '', rank: '' })
})

test('Beamtenliste: Gekündigte nur mit Kontrolle, Dienstnummer ohne interne Markierung', async () => {
  const { buildOfficerDirectory } = await import('../src/lib/quality-checks')
  const officer = (id: string, status: string, badgeNumber: string) => ({
    id, firstName: 'Max', lastName: id, badgeNumber, discordId: null, status,
    rank: { name: 'Officer', color: '#fff', sortOrder: 1 }, units: [], hireDate: '2026-01-01T00:00:00.000Z',
  })
  const stat = (id: string, badgeNumber: string) => ({
    lspdOfficerId: id, name: `Max ${id}`, badgeNumber, rank: 'Officer', total: 1, running: 0,
    ratings: { POSITIVE: 1, NEUTRAL: 0, NEGATIVE: 0 }, lastCheckAt: '2026-09-01T00:00:00.000Z',
  })
  const rows = buildOfficerDirectory({
    active: [officer('a', 'ACTIVE', '12')],
    terminated: [officer('t1', 'TERMINATED', '01__terminated__t1'), officer('t2', 'TERMINATED', '02__terminated__t2')],
    stats: [stat('t1', '01'), stat('weg', '07__terminated__weg')],
    term: '',
  })
  assert.deepEqual(rows.map((row) => [row.id, row.badge, row.status, row.terminated]), [
    ['a', '12', 'Aktiv', false],
    ['t1', '01', 'Gekündigt', true],
    ['weg', '07', '', false],
  ])
})
