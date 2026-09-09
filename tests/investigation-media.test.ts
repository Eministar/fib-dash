import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateDossierParent, dossierSchema } from '../src/lib/dossiers-server'
import { validateIdList } from '../src/lib/investigations'
import { detectPhotoType, isDiscordImageUrl, photoPath } from '../src/lib/investigation-photos'
import { activateChangeTracking, currentChangeTracking, withoutChangeTracking } from '../src/lib/change-history-context'

test('Background jobs do not become part of a request undo snapshot', async () => {
  activateChangeTracking({ changeSetId: 'request', userId: 'user' })
  await withoutChangeTracking(async () => {
    await Promise.resolve()
    assert.equal(currentChangeTracking(), undefined)
  })
  assert.equal(currentChangeTracking()?.changeSetId, 'request')
})

test('Dossier moves reject self-parenting, descendants, corrupt cycles and missing parents', async () => {
  const parents: Record<string, string | null> = { family: null, property: 'family', room: 'property', cycleA: 'cycleB', cycleB: 'cycleA' }
  const lookup = async (id: string) => id in parents ? { parentId: parents[id] } : null
  await validateDossierParent('room', 'family', lookup)
  await validateDossierParent('family', null, lookup)
  await assert.rejects(validateDossierParent('family', 'family', lookup), /selbst/)
  await assert.rejects(validateDossierParent('family', 'room', lookup), /selbst/)
  await assert.rejects(validateDossierParent('family', 'cycleA', lookup), /selbst/)
  await assert.rejects(validateDossierParent('family', 'missing', lookup), /nicht gefunden/)
})

test('Dossiers accept fixed categories and reject invalid or unbounded fields', () => {
  assert.equal(dossierSchema.parse({ title: ' Familie Moretti ', kind: 'FAMILY', photoId: null }).title, 'Familie Moretti')
  for (const value of [{ title: '', kind: 'FILE' }, { title: 'A', kind: 'UNKNOWN' }, { title: 'A', kind: 'FILE', titleExtra: true }, { title: 'A', kind: 'FILE', personIds: Array(201).fill('x') }]) {
    assert.equal(dossierSchema.safeParse(value).success, false)
  }
})

test('Dossiers nehmen Kartenpunkte an und begrenzen ihre Zahl', () => {
  const parsed = dossierSchema.parse({ title: 'Familie Moretti', kind: 'FAMILY', mapSpotIds: ['spot-1', 'spot-2'] })
  assert.deepEqual(parsed.mapSpotIds, ['spot-1', 'spot-2'])
  assert.equal(dossierSchema.safeParse({ title: 'A', kind: 'FAMILY', mapSpotIds: Array(201).fill('x') }).success, false)
  assert.equal(dossierSchema.safeParse({ title: 'A', kind: 'FAMILY', mapSpotIds: [''] }).success, false)
})

test('Photo imports restrict remote addresses, file paths and image types', () => {
  assert.equal(isDiscordImageUrl('https://cdn.discordapp.com/attachments/1/2/photo.png?ex=123'), true)
  for (const url of ['http://cdn.discordapp.com/attachments/x', 'https://cdn.discordapp.com.evil.test/attachments/x', 'https://user@cdn.discordapp.com/attachments/x', 'https://127.0.0.1/attachments/x', 'https://cdn.discordapp.com:444/attachments/x', 'https://cdn.discordapp.com/other']) assert.equal(isDiscordImageUrl(url), false)
  assert.throws(() => photoPath('../../secret.png'))
  assert.equal(detectPhotoType(Buffer.from('<svg onload="evil()"/>')), null)
  assert.equal(detectPhotoType(Buffer.from([255, 216, 255]))?.mimeType, 'image/jpeg')
  assert.equal(detectPhotoType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))?.mimeType, 'image/png')
})

test('ID-Listen für Kartenpunkte und Bilder werden entdoppelt und begrenzt', () => {
  assert.deepEqual(validateIdList(['a', 'b', 'a']), ['a', 'b'])
  assert.deepEqual(validateIdList(undefined), [])
  assert.deepEqual(validateIdList([]), [])
  assert.throws(() => validateIdList('a'), /Liste/)
  assert.throws(() => validateIdList([1]), /Liste/)
  assert.throws(() => validateIdList(['']), /Liste/)
  assert.throws(() => validateIdList(Array(201).fill('x')), /zu viele/i)
})
