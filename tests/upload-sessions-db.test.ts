// Muss vor jedem Prisma-Import stehen: setzt DATABASE_URL auf die Testdatenbank.
import './db-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import path from 'node:path'
import { mkdtemp, readFile, rename } from 'node:fs/promises'
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
  stagedPath,
  assembleUploadSession,
  consumeUploadSession,
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

test('Zusammensetzen prueft Vollstaendigkeit und liefert ein einmaliges Ticket', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  process.env.UPLOAD_CHUNK_BYTES = String(1024)
  t.after(() => {
    delete process.env.UPLOAD_CHUNK_BYTES
  })

  const owner = await makeUser('Testnutzer')
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  const file = Buffer.alloc(2500, 0x5a)
  file.write('ftyp', 4, 'ascii')
  const expectedHash = createHash('sha256').update(file).digest('hex')

  const session = await openUploadSession({
    kind: 'CLIP',
    ownerId: owner.id,
    originalName: 'a.mp4',
    mimeType: 'video/mp4',
    totalBytes: file.length,
    fingerprint: 'a.mp4:2500:1',
  })
  assert.equal(session.chunkCount, 3)

  // Unvollstaendig: das Zusammensetzen muss scheitern.
  await assert.rejects(
    () => assembleUploadSession(session.sessionId, owner.id),
    (cause: UploadSessionError) => cause.status === 409,
  )

  // Absichtlich in vertauschter Reihenfolge senden.
  for (const index of [2, 0, 1]) {
    const part = file.subarray(index * 1024, Math.min((index + 1) * 1024, file.length))
    await storeChunk(
      session.sessionId,
      index,
      streamOf(part),
      createHash('sha256').update(part).digest('hex'),
      part.length,
    )
  }

  const result = await assembleUploadSession(session.sessionId, owner.id)
  assert.equal(result.sizeBytes, file.length)
  assert.equal(result.sha256, expectedHash)
  assert.deepEqual(await readFile(stagedPath(session.sessionId, '.mp4')), file)
  // Der Chunk-Ordner ist danach weg.
  assert.deepEqual(await receivedChunkIndexes(session.sessionId), [])

  // Einloesen verschiebt die Datei und entwertet das Ticket.
  const ticket = await consumeUploadSession(session.sessionId, owner.id, 'CLIP', async (source, extension) => {
    const target = path.join(directory, `final${extension}`)
    await rename(source, target)
    return path.basename(target)
  })
  assert.equal(ticket.filename, 'final.mp4')
  assert.equal(ticket.originalName, 'a.mp4')
  assert.equal(ticket.sizeBytes, file.length)

  await assert.rejects(
    () => consumeUploadSession(session.sessionId, owner.id, 'CLIP', async () => 'x'),
    (cause: UploadSessionError) => cause.status === 409,
  )
})

test('Eine Datei mit fremder Signatur wird beim Abschluss abgewiesen', async (t) => {
  process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  const owner = await makeUser('Testnutzer')
  t.after(async () => {
    await prisma.uploadSession.deleteMany({ where: { ownerId: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  // Eine Windows-Programmdatei, die sich als MP4 ausgibt.
  const disguised = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
  const session = await openUploadSession({
    kind: 'CLIP',
    ownerId: owner.id,
    originalName: 'b.mp4',
    mimeType: 'video/mp4',
    totalBytes: disguised.length,
    fingerprint: 'b.mp4:8:1',
  })
  await storeChunk(
    session.sessionId,
    0,
    streamOf(disguised),
    createHash('sha256').update(disguised).digest('hex'),
    disguised.length,
  )

  await assert.rejects(
    () => assembleUploadSession(session.sessionId, owner.id),
    (cause: UploadSessionError) => cause.status === 415,
  )
  const stored = await prisma.uploadSession.findUnique({ where: { id: session.sessionId } })
  assert.equal(stored?.status, 'FAILED')
})
