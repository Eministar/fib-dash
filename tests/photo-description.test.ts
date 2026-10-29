import assert from 'node:assert/strict'
import { test } from 'node:test'
import { photoDescriptionSchema } from '../src/lib/investigations/photo-description'

test('Bildbeschreibungen erhalten Zeilenumbrüche und können entfernt werden', () => {
  assert.equal(photoDescriptionSchema.parse('  Eingang\nHinterhof  '), 'Eingang\nHinterhof')
  assert.equal(photoDescriptionSchema.parse(' \n '), null)
  assert.equal(photoDescriptionSchema.parse(null), null)
})

test('Bildbeschreibungen begrenzen Länge und akzeptieren nur Text oder null', () => {
  assert.equal(photoDescriptionSchema.safeParse('a'.repeat(5000)).success, true)
  for (const input of ['a'.repeat(5001), 42, {}, undefined]) {
    assert.equal(photoDescriptionSchema.safeParse(input).success, false)
  }
})
