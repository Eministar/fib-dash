import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { transcodeClip, probeClip, runMediaTool, compressionOptions, validCompressedDuration } from '../src/lib/clip-transcode'

test('real AV1 conversion reduces size, preserves audio/duration and does not upscale', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fib-clip-test-'))
  try {
    const source = path.join(dir, 'source.mp4')
    const output = path.join(dir, 'compact.webm')
    await runMediaTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=60:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-c:a', 'aac', '-shortest', source], 30_000)
    const originalSize = (await stat(source)).size
    const result = await transcodeClip(source, output, { ...compressionOptions(), codec: 'av1', timeoutMs: 60_000 })
    assert.equal(result.skipped, false)
    assert.ok((await stat(output)).size < originalSize)
    assert.equal((await stat(source)).size, originalSize, 'Transcoder must never delete the original')
    const info = await probeClip(output)
    assert.equal(info.video.codec_name, 'av1')
    assert.equal(info.audioCount, 1)
    assert.equal(info.video.width, 640)
    assert.equal(info.video.height, 360)
    assert.ok(validCompressedDuration(3, info.duration))
    const [n, d] = info.video.avg_frame_rate!.split('/').map(Number)
    assert.ok(n / d <= 30)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('silent portrait video keeps its orientation; invalid input preserves source and cleans output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fib-clip-portrait-'))
  try {
    const source = path.join(dir, 'portrait.mp4')
    const output = path.join(dir, 'portrait.webm')
    await runMediaTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', source], 30_000)
    const result = await transcodeClip(source, output, { ...compressionOptions(), codec: 'av1', timeoutMs: 60_000 })
    assert.equal(result.skipped, false)
    const info = await probeClip(output)
    assert.equal(info.audioCount, 0)
    assert.ok(info.video.width! < info.video.height!)
    assert.ok(info.video.height! <= 720)
    const invalid = path.join(dir, 'invalid.mp4')
    const incomplete = path.join(dir, 'invalid.webm')
    await writeFile(invalid, 'not a video')
    await assert.rejects(transcodeClip(invalid, incomplete))
    assert.equal((await stat(invalid)).size, 11)
    await assert.rejects(stat(incomplete), { code: 'ENOENT' })
    assert.equal(validCompressedDuration(100, 95), false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Der Grund eines Fehlschlags landet im Datensatz, nicht nur im Log', async () => {
  const { compressionFailureText } = await import('../src/lib/clip-compression')

  // Der echte ffmpeg-Text muss durchkommen - vorher stand hier ein fester
  // Satz, und jeder Fehlschlag sah von aussen gleich aus.
  const text = compressionFailureText(
    new Error('Videokonvertierung fehlgeschlagen: Error while opening encoder - maybe incorrect parameters'),
  )
  assert.match(text, /Original bleibt erhalten/)
  assert.match(text, /incorrect parameters/)

  // Dateipfade gehoeren nicht in die Oberflaeche.
  const withPath = compressionFailureText(
    new Error('Fehler bei C:\\Users\\srv\\clips\\abc.mp4 beim Lesen'),
  )
  assert.doesNotMatch(withPath, /C:\\Users/)
  assert.match(withPath, /<Datei>/)

  const unixPath = compressionFailureText(new Error('konnte /var/www/uploads/clips/abc.mp4 nicht lesen'))
  assert.doesNotMatch(unixPath, /\/var\/www/)

  // Das Feld fasst 300 Zeichen - laengere Meldungen werden gekuerzt.
  assert.ok(compressionFailureText(new Error('x'.repeat(2000))).length <= 300)

  // Auch etwas, das kein Error ist, ergibt einen brauchbaren Satz.
  assert.match(compressionFailureText('kaputt'), /Grund: kaputt/)
  assert.match(compressionFailureText(new Error('')), /Grund: unbekannt/)
})

test('Der Encoder wird aus dem gewaehlt, was ffmpeg tatsaechlich kann', async () => {
  const { pickCodec } = await import('../src/lib/clip-transcode')

  const alles = ' V..... libsvtav1  SVT-AV1\n V....D libvpx-vp9  VP9\n A....D libopus  Opus\n'
  const ohneAv1 = ' V....D libvpx-vp9  VP9\n A....D libopus  Opus\n'
  const ohneOpus = ' V..... libsvtav1  SVT-AV1\n V....D libvpx-vp9  VP9\n'

  // Ist der gewuenschte Encoder da, wird er genommen.
  assert.deepEqual(pickCodec(alles, 'av1'), { codec: 'av1', fallback: null })
  assert.deepEqual(pickCodec(alles, 'vp9'), { codec: 'vp9', fallback: null })

  // Fehlt er, wird der andere genommen statt aufzugeben. Ein schwaecherer
  // Encoder ist besser als gar keiner - genau daran hing die Komprimierung.
  const gewichen = pickCodec(ohneAv1, 'av1')
  assert.equal(gewichen.codec, 'vp9')
  assert.match(gewichen.fallback!, /libsvtav1/)

  // Ohne Tonspur-Encoder geht nichts, und die Meldung sagt was fehlt.
  assert.throws(() => pickCodec(ohneOpus, 'av1'), (cause: Error) => /libopus/.test(cause.message))

  // Ein ffmpeg ohne beide Video-Encoder nennt beide beim Namen.
  const nurOpus = ' A....D libopus  Opus'
  assert.throws(
    () => pickCodec(nurOpus, 'av1'),
    (cause: Error) => /libsvtav1/.test(cause.message) && /libvpx-vp9/.test(cause.message),
  )

  // Eine leere Ausgabe bedeutet in der Praxis: ffmpeg fehlt ganz. Genau das
  // war auf dem Server der Fall.
  assert.throws(() => pickCodec('', 'av1'), /ffmpeg/i)
  assert.throws(() => pickCodec('', 'vp9'), /installiert/i)
})
