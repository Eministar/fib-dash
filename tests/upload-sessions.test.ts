import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { matchesFileSignature } from '../src/lib/upload-signatures'
import {
  chunkCountFor,
  chunkPath,
  incomingDir,
  receivedChunkIndexes,
  uploadChunkBytes,
  uploadKindRules,
  UploadSessionError,
  storeChunk,
} from '../src/lib/upload-sessions'

function streamOf(buffer: Buffer) {
  return Readable.toWeb(Readable.from([buffer])) as ReadableStream<Uint8Array>
}

function head(bytes: number[]) {
  const buffer = Buffer.alloc(32)
  Buffer.from(bytes).copy(buffer)
  return buffer
}

test('Signaturprüfung erkennt erlaubte Formate und weist fremde ab', () => {
  const mp4 = Buffer.alloc(32)
  mp4.write('ftyp', 4, 'ascii')
  assert.equal(matchesFileSignature('video/mp4', mp4), true)
  assert.equal(matchesFileSignature('video/quicktime', mp4), true)

  // WebM und MKV teilen sich die EBML-Signatur und sind hier nicht
  // unterscheidbar — beide müssen akzeptiert werden.
  const ebml = head([0x1a, 0x45, 0xdf, 0xa3])
  assert.equal(matchesFileSignature('video/webm', ebml), true)
  assert.equal(matchesFileSignature('video/x-matroska', ebml), true)

  assert.equal(matchesFileSignature('image/png', head([137, 80, 78, 71, 13, 10, 26, 10])), true)
  assert.equal(matchesFileSignature('image/jpeg', head([0xff, 0xd8, 0xff, 0xe0])), true)
  assert.equal(matchesFileSignature('application/pdf', head([0x25, 0x50, 0x44, 0x46, 0x2d])), true)

  const webp = Buffer.alloc(32)
  webp.write('RIFF', 0, 'ascii')
  webp.write('WEBP', 8, 'ascii')
  assert.equal(matchesFileSignature('image/webp', webp), true)

  // Eine ausführbare Datei, die sich als Video ausgibt.
  assert.equal(matchesFileSignature('video/mp4', head([0x4d, 0x5a, 0x90, 0x00])), false)
  assert.equal(matchesFileSignature('application/x-msdownload', head([0x4d, 0x5a])), false)
})

test('Chunk-Aufteilung und Pfade', () => {
  assert.equal(uploadChunkBytes(), 8 * 1024 * 1024)
  assert.equal(chunkCountFor(8 * 1024 * 1024, 8 * 1024 * 1024), 1)
  assert.equal(chunkCountFor(8 * 1024 * 1024 + 1, 8 * 1024 * 1024), 2)
  assert.equal(chunkCountFor(214958080, 8 * 1024 * 1024), 26)

  assert.equal(uploadKindRules.CLIP.types['video/x-matroska'], '.mkv')
  assert.equal(uploadKindRules.RESOURCE.maxBytes(), 10 * 1024 * 1024)

  // Ein manipulierter Bezeichner darf nie aus dem Zielordner herausführen.
  assert.throws(() => incomingDir('../../etc'), UploadSessionError)
  assert.throws(() => chunkPath('clxsession0001abcd', -1), UploadSessionError)
  assert.throws(() => chunkPath('clxsession0001abcd', 1.5), UploadSessionError)
})

test('Empfangene Chunks werden aus dem Dateisystem gelesen', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const session = 'clxsession0001abcd'
  await mkdir(incomingDir(session), { recursive: true })
  await writeFile(chunkPath(session, 3), 'x')
  await writeFile(chunkPath(session, 0), 'x')
  // Eine halbfertige Datei zählt nicht mit.
  await writeFile(path.join(incomingDir(session), '7.tmp'), 'x')

  assert.deepEqual(await receivedChunkIndexes(session), [0, 3])
  assert.deepEqual(await receivedChunkIndexes('clxsession0002abcd'), [])
})

test('Chunks werden nur bei passender Länge und Prüfsumme abgelegt', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fib-upload-'))
  process.env.UPLOAD_DIR = directory
  const session = 'clxsession0003abcd'
  const payload = Buffer.alloc(1024, 0x41)
  const digest = createHash('sha256').update(payload).digest('hex')

  await storeChunk(session, 0, streamOf(payload), digest, payload.length)
  assert.deepEqual(await receivedChunkIndexes(session), [0])

  // Doppelte Zustellung nach einem Wiederholversuch ist unschädlich.
  await storeChunk(session, 0, streamOf(payload), digest, payload.length)
  assert.deepEqual(await receivedChunkIndexes(session), [0])

  await assert.rejects(
    () => storeChunk(session, 1, streamOf(payload), 'f'.repeat(64), payload.length),
    (cause: UploadSessionError) => cause.status === 400,
  )
  await assert.rejects(
    () => storeChunk(session, 2, streamOf(payload), digest, payload.length + 1),
    (cause: UploadSessionError) => cause.status === 400,
  )

  // Abgelehnte Chunks hinterlassen weder .part noch .tmp.
  assert.deepEqual(await receivedChunkIndexes(session), [0])
  assert.deepEqual((await readdir(incomingDir(session))).sort(), ['0.part'])
})
