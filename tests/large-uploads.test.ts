import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { config } from '../src/proxy'
import { saveClipStream, resolveClipPath } from '../src/lib/clips'
import { saveEvidence, evidencePath } from '../src/lib/corruption-evidence'
import { uploadOptions } from '../src/lib/upload-cors'

const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as { pathToRegexp: (pattern: string) => RegExp }

test('Binary uploads bypass Next proxy buffering; access and other APIs remain covered', () => {
  const matcher = pathToRegexp(config.matcher)
  for (const url of ['/api/investigations/clips', '/api/investigations/clips/', '/api/corruption-checks/example/evidence']) assert.equal(matcher.test(url), false)
  for (const url of ['/api/investigations/clips/access', '/api/investigations/clips/example/stream', '/api/agents']) assert.equal(matcher.test(url), true)
  const response = uploadOptions(new Request('http://localhost/api/investigations/clips', { headers: { origin: 'https://client.example' } }))
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://client.example')
  assert.match(response.headers.get('Access-Control-Allow-Headers')!, /X-Upload-Size/)
})

test('200 MiB crosses real HTTP intact for both clip and evidence writers; truncated uploads are removed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-large-upload-'))
  const previousClipDir = process.env.CLIP_DIR
  const previousUploadDir = process.env.UPLOAD_DIR
  process.env.CLIP_DIR = directory
  process.env.UPLOAD_DIR = directory
  const size = 200 * 1024 * 1024
  const chunk = Buffer.alloc(256 * 1024, 0x5a)
  chunk.write('ftyp', 4, 'ascii')
  const expected = createHash('sha256')
  for (let bytes = 0; bytes < size; bytes += chunk.length) expected.update(chunk)
  const expectedHash = expected.digest('hex')
  const files: string[] = []
  const server = createServer(async (req, res) => {
    try {
      const body = Readable.toWeb(req) as ReadableStream<Uint8Array>
      const result = req.url === '/evidence' ? await saveEvidence(body, 'video/mp4', size) : await saveClipStream(body, 'video/mp4', size)
      const file = req.url === '/evidence' ? evidencePath(result.filename) : resolveClipPath(result.filename)
      files.push(file)
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(file)) hash.update(bytes)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ size: (await stat(file)).size, hash: hash.digest('hex') }))
    } catch (cause) { res.statusCode = 500; res.end(String(cause)) }
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    for (const endpoint of ['/clip', '/evidence']) {
      let sent = 0
      const body = new ReadableStream({ pull(controller) { if (sent >= size) controller.close(); else { controller.enqueue(chunk); sent += chunk.length } } })
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: 'POST', body, duplex: 'half' } as RequestInit)
      assert.equal(response.status, 200, await response.clone().text())
      assert.deepEqual(await response.json(), { size, hash: expectedHash })
    }
    const before = await readdir(directory)
    await assert.rejects(saveClipStream(new ReadableStream({ start(c) { c.enqueue(chunk); c.close() } }), 'video/mp4', size), /unvollständig/)
    assert.deepEqual(await readdir(directory), before)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    for (const file of files) await unlink(file)
    await rmdir(path.join(directory, 'corruption-evidence')).catch(() => {})
    await rmdir(directory)
    if (previousClipDir === undefined) delete process.env.CLIP_DIR; else process.env.CLIP_DIR = previousClipDir
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir
  }
})
