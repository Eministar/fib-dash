import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAP_CATEGORIES, mapLayer } from '../src/lib/investigations/map-spots'
import { createSpotSchema, updateSpotSchema } from '../src/lib/investigations/map-server'

test('Bestehende Kategorien bleiben auf der Routenkarte; Anwesen und Fraktionen sind getrennt', () => {
  for (const category of ['weed', 'lsd', 'kokain', 'heroin', 'waffen', 'munition', 'schwarzmarkt', 'other', 'route', 'processor']) {
    assert.equal(mapLayer(category), 'routes')
  }
  assert.equal(mapLayer('estate'), 'estates')
  assert.equal(mapLayer('faction'), 'estates')
  assert.equal(mapLayer('unknown-legacy-category'), 'routes')
})

test('Jede angebotene Pin-Kategorie lässt sich anlegen und ändern', () => {
  for (const category of MAP_CATEGORIES) {
    assert.equal(createSpotSchema.parse({ title: category.label, category: category.id, x: 20, y: 50 }).category, category.id)
    assert.equal(updateSpotSchema.parse({ category: category.id }).category, category.id)
  }
  assert.equal(createSpotSchema.safeParse({ title: 'Anwesen', category: 'invalid', x: 20, y: 50 }).success, false)
  assert.equal(createSpotSchema.safeParse({ title: 'Anwesen', category: 'estate', x: 120, y: 50 }).success, false)
})
