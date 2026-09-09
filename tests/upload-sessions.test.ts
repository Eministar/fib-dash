import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesFileSignature } from '../src/lib/upload-signatures'

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
