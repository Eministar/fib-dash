// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import { prisma } from '../src/lib/prisma'
import {
  MAX_OPEN_SESSIONS_PER_USER,
  cancelUploadSession,
  loadOwnedSession,
  openUploadSession,
  receivedChunkIndexes,
  storeChunk,
  UploadSessionError,
} from '../src/lib/upload-sessions'

// Ohne dies bleibt der Testprozess nach dem letzten Test an der offenen
// Datenbankverbindung hängen.
after(() => prisma.$disconnect())

function streamOf(buffer: Buffer) {
  return Readable.toWeb(Readable.from([buffer])) as ReadableStream<Uint8Array>
}

async function makeUser(displayName: string) {
  return prisma.user.create({
    data: {
      username: `test-${randomUUID().slice(0, 12)}`,
      displayName,
      passwordHash: 'nicht-verwendet',
      role: 'ADMIN',
    },
  })
}

test('Sitzungen werden wiedergefunden, begrenzt und gegen Fremdzugriff geschützt', async (t) => {
  process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))

  const owner = await makeUser('Testnutzer')
  const stranger = await makeUser('Fremder')
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: { in: [owner.id, stranger.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })
  })

  const input = {
    kind: 'CLIP' as const,
    ownerId: owner.id,
    originalName: 'zugriff.mp4',
    mimeType: 'video/mp4',
    totalBytes: 214958080,
    fingerprint: 'zugriff.mp4:214958080:1757320145000',
  }

  const first = await openUploadSession(input)
  assert.equal(first.chunkCount, 26)
  assert.equal(first.resumed, false)
  assert.deepEqual(first.received, [])

  const payload = Buffer.alloc(64, 7)
  await storeChunk(
    first.sessionId,
    0,
    streamOf(payload),
    createHash('sha256').update(payload).digest('hex'),
    payload.length,
  )

  // Dieselbe Datei erneut gewählt: dieselbe Sitzung, mit Fortschritt.
  const again = await openUploadSession(input)
  assert.equal(again.sessionId, first.sessionId)
  assert.equal(again.resumed, true)
  assert.deepEqual(again.received, [0])

  // Ein zu großer Clip wird abgelehnt, bevor ein einziges Byte fließt.
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'zu-gross', totalBytes: 900 * 1024 * 1024 }),
    (cause: UploadSessionError) => cause.status === 413,
  )

  // Ein nicht erlaubtes Format ebenso.
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'falsch', mimeType: 'application/x-msdownload' }),
    (cause: UploadSessionError) => cause.status === 415,
  )

  // Kontingent: die vierte offene Sitzung wird abgewiesen.
  for (let n = 2; n <= MAX_OPEN_SESSIONS_PER_USER; n += 1) {
    await openUploadSession({ ...input, fingerprint: `datei-${n}` })
  }
  await assert.rejects(
    () => openUploadSession({ ...input, fingerprint: 'eine-zu-viel' }),
    (cause: UploadSessionError) => cause.status === 429,
  )

  // Fremde Sitzungen existieren nach außen nicht — 404, nicht 403.
  await assert.rejects(
    () => loadOwnedSession(first.sessionId, stranger.id),
    (cause: UploadSessionError) => cause.status === 404,
  )
  await assert.rejects(
    () => cancelUploadSession(first.sessionId, stranger.id),
    (cause: UploadSessionError) => cause.status === 404,
  )

  await cancelUploadSession(first.sessionId, owner.id)
  assert.deepEqual(await receivedChunkIndexes(first.sessionId), [])
  assert.equal(await prisma.uploadSession.findUnique({ where: { id: first.sessionId } }), null)
})
