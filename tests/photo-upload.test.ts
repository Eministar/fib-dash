import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_PHOTO_UPLOAD_BYTES, PhotoUploadError, savePhotoUpload } from '../src/lib/investigation-photo-upload'
import { photoPath } from '../src/lib/investigation-photos'

/** Jeder Testlauf bekommt ein eigenes Upload-Verzeichnis. `uploadDir()` liest
 *  die Variable bei jedem Aufruf, deshalb genügt es, sie vor dem ersten
 *  Speichern zu setzen – der Import oben darf davor liegen. */
const workspace = mkdtempSync(path.join(tmpdir(), 'fib-photo-'))
process.env.UPLOAD_DIR = workspace

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function streamOf(...parts: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new Uint8Array(part))
      controller.close()
    },
  })
}

test('Ein PNG landet unter zufälligem Namen im Bildverzeichnis', async () => {
  const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(64, 7)])
  const saved = await savePhotoUpload(streamOf(payload))
  assert.equal(saved.mimeType, 'image/png')
  assert.equal(saved.sizeBytes, payload.length)
  assert.match(saved.filename, /^[a-f0-9-]{36}\.png$/)
  assert.deepEqual(await readFile(photoPath(saved.filename)), payload)
})

test('Der Dateityp kommt aus den Magic Bytes, nicht aus dem Dateinamen', async () => {
  const svg = Buffer.from('<svg onload="evil()"/>')
  await assert.rejects(savePhotoUpload(streamOf(svg)), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.match(cause.message, /JPG, PNG, WebP und GIF/)
    return true
  })
})

test('Ein leerer Upload wird abgewiesen', async () => {
  await assert.rejects(savePhotoUpload(streamOf()), /Datei fehlt/)
})

test('Zu große Bilder werden mit 413 abgewiesen – angekündigt wie tatsächlich', async () => {
  await assert.rejects(savePhotoUpload(streamOf(PNG_HEADER), MAX_PHOTO_UPLOAD_BYTES + 1), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.equal(cause.status, 413)
    return true
  })
  const oversized = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_PHOTO_UPLOAD_BYTES, 1)])
  await assert.rejects(savePhotoUpload(streamOf(oversized)), (cause: unknown) => {
    assert.ok(cause instanceof PhotoUploadError)
    assert.equal(cause.status, 413)
    return true
  })
})

test('Eine abgebrochene Übertragung wird erkannt und hinterlässt keine Datei', async () => {
  const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(16, 3)])
  await assert.rejects(savePhotoUpload(streamOf(payload), payload.length + 10), /unvollständig/)
})

test('Unsinnige Größenangaben werden abgewiesen', async () => {
  for (const size of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(savePhotoUpload(streamOf(PNG_HEADER), size), /Dateigröße/)
  }
})

test.after(async () => { await rm(workspace, { recursive: true, force: true }) })
