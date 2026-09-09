// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import path from 'node:path'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { AddressInfo } from 'node:net'

import { prisma } from '../src/lib/prisma'
import {
  assembleUploadSession,
  openUploadSession,
  receivedChunkIndexes,
  stagedPath,
  storeChunk,
  uploadChunkBytes,
} from '../src/lib/upload-sessions'

after(() => prisma.$disconnect())

/**
 * Bildet die Chunk-Route ueber einen echten HTTP-Server nach: dieselben
 * Aufrufe, aber ohne Next-Laufzeit. Damit laeuft der Request-Body wirklich
 * ueber eine Netzwerkverbindung, statt nur durch einen Funktionsaufruf.
 */
function startChunkServer(sessionId: string, chunkSize: number, totalBytes: number, chunkCount: number) {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const index = Number.parseInt(new URL(req.url!, 'http://x').pathname.split('/').pop()!, 10)
        const isLast = index === chunkCount - 1
        const expected = isLast ? totalBytes - chunkSize * index : chunkSize
        const body = Readable.toWeb(req) as ReadableStream<Uint8Array>
        await storeChunk(sessionId, index, body, req.headers['x-chunk-sha256'] as string, expected)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (cause) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: (cause as Error).message }))
      }
    })()
  })
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    )
  })
}

test('200 MiB gehen parallel und in vertauschter Reihenfolge ueber echtes HTTP', async (t) => {
  process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), 'fib-chunk-'))

  const owner = await prisma.user.create({
    data: {
      username: `test-${randomUUID().slice(0, 12)}`,
      displayName: 'Testnutzer',
      passwordHash: 'nicht-verwendet',
      role: 'ADMIN',
    },
  })
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  const chunkSize = uploadChunkBytes()
  const totalBytes = 200 * 1024 * 1024
  const block = Buffer.alloc(1024 * 1024, 0x5a)
  block.write('ftyp', 4, 'ascii')

  // Die Quelle wird nie am Stueck im Speicher gehalten.
  const sourceHash = createHash('sha256')
  for (let sent = 0; sent < totalBytes; sent += block.length) sourceHash.update(block)
  const expectedHash = sourceHash.digest('hex')

  const session = await openUploadSession({
    kind: 'CLIP',
    ownerId: owner.id,
    originalName: 'gross.mp4',
    mimeType: 'video/mp4',
    totalBytes,
    fingerprint: `gross.mp4:${totalBytes}:1`,
  })
  assert.equal(session.chunkCount, Math.ceil(totalBytes / chunkSize))

  const server = await startChunkServer(session.sessionId, chunkSize, totalBytes, session.chunkCount)
  t.after(() => server.close())

  const chunkFor = (index: number) => {
    const size = index === session.chunkCount - 1 ? totalBytes - chunkSize * index : chunkSize
    const buffer = Buffer.alloc(size)
    for (let offset = 0; offset < size; offset += block.length) {
      block.copy(buffer, offset, 0, Math.min(block.length, size - offset))
    }
    // Nur der allererste Chunk traegt die Dateisignatur.
    if (index !== 0) buffer.write('ZZZZ', 4, 'ascii')
    return buffer
  }

  // Absichtlich rueckwaerts, mit drei gleichzeitigen Verbindungen.
  const queue = Array.from({ length: session.chunkCount }, (_, i) => i).reverse()
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        const buffer = chunkFor(index)
        const response = await fetch(`http://127.0.0.1:${server.port}/chunks/${index}`, {
          method: 'PUT',
          headers: { 'x-chunk-sha256': createHash('sha256').update(buffer).digest('hex') },
          body: buffer,
        })
        assert.equal(response.status, 200, `Chunk ${index} abgelehnt`)
      }
    }),
  )

  assert.equal((await receivedChunkIndexes(session.sessionId)).length, session.chunkCount)

  const result = await assembleUploadSession(session.sessionId, owner.id)
  assert.equal(result.sizeBytes, totalBytes)

  // Der Gesamt-Hash entsteht serverseitig beim Zusammensetzen und muss dem
  // entsprechen, was tatsaechlich gesendet wurde.
  const rebuilt = createHash('sha256')
  for (let index = 0; index < session.chunkCount; index += 1) rebuilt.update(chunkFor(index))
  assert.equal(result.sha256, rebuilt.digest('hex'))
  assert.notEqual(result.sha256, expectedHash) // Sanity: die Chunks sind bewusst markiert.

  const staged = stagedPath(session.sessionId, '.mp4')
  assert.ok(staged.endsWith('.mp4'))
})
