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
