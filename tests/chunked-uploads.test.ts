import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

import { config } from '../src/proxy'
import { uploadOptions } from '../src/lib/upload-cors'

const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: (pattern: string) => RegExp
}

test('Nur die Chunk-Route umgeht den Body-klonenden Proxy', () => {
  const matcher = pathToRegexp(config.matcher)

  // Der einzige Request, der noch gross wird.
  assert.equal(matcher.test('/api/uploads/clx0000000000000001/chunks/0'), false)
  assert.equal(matcher.test('/api/uploads/clx0000000000000001/chunks/25'), false)

  // Die kleinen JSON-Endpunkte duerfen weiterhin durch den Proxy laufen.
  assert.equal(matcher.test('/api/uploads'), true)
  assert.equal(matcher.test('/api/uploads/clx0000000000000001'), true)
  assert.equal(matcher.test('/api/uploads/clx0000000000000001/complete'), true)
  assert.equal(matcher.test('/api/agents'), true)
  assert.equal(matcher.test('/api/investigations/clips'), true)
  assert.equal(matcher.test('/api/corruption-checks/example/evidence'), true)
})

test('Der Preflight erlaubt den Pruefsummen-Header', () => {
  const response = uploadOptions(
    new Request('http://localhost/api/uploads/clx0000000000000001/chunks/0', {
      headers: { origin: 'https://client.example' },
    }),
  )
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://client.example')
  assert.match(response.headers.get('Access-Control-Allow-Headers')!, /X-Chunk-Sha256/)
})
