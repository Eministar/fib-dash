import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadVideoFrame, videoErrorText } from '../desktop/src/ui/video-loading'

class Video extends EventTarget {
  src = ''
  duration = Number.NaN
  currentTime = 0
  videoWidth = 0
  videoHeight = 0
  readyState = 0
  seeking = false
  error: { code: number; message: string } | null = null
  loads = 0
  pause() {}
  removeAttribute() { this.src = '' }
  load() { this.loads++ }
  get element() { return this as unknown as HTMLVideoElement }
  metadata(duration = 60, width = 1920, height = 1080) {
    Object.assign(this, { duration, videoWidth: width, videoHeight: height, readyState: 1 })
    this.dispatchEvent(new Event('loadedmetadata'))
  }
  frame() {
    this.readyState = 2
    this.dispatchEvent(new Event('loadeddata'))
  }
}

test('setup waits for a decoded frame, not just metadata', async () => {
  const video = new Video()
  const controller = new AbortController()
  let settled = false
  const result = loadVideoFrame(video.element, 'asset://original.mp4', { startAt: -3, signal: controller.signal })
  void result.then(() => { settled = true })
  video.metadata()
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(video.currentTime, 57)
  assert.equal(video.src, 'asset://original.mp4')
  assert.equal(video.loads, 2, 'release old decoder and explicitly start the new resource')
  video.frame()
  assert.equal(await result, 60)
})

test('a frame from before the initial seek does not unlock setup', async () => {
  const video = new Video()
  let settled = false
  const result = loadVideoFrame(video.element, 'asset://clip.mp4', { startAt: 10, signal: new AbortController().signal })
  void result.then(() => { settled = true })
  video.metadata()
  video.seeking = true
  video.frame()
  await Promise.resolve()
  assert.equal(settled, false)
  video.seeking = false
  video.dispatchEvent(new Event('seeked'))
  assert.equal(await result, 60)
})

test('audio-only playback is reported instead of accepting a black player', async () => {
  const video = new Video()
  const result = loadVideoFrame(video.element, 'asset://clip.mp4', { startAt: 0, signal: new AbortController().signal })
  const rejected = assert.rejects(result, /nur Ton oder keine lesbare Videospur/)
  video.metadata(60, 0, 0)
  await rejected
})

test('decoder failures report the media error code', async () => {
  const video = new Video()
  const result = loadVideoFrame(video.element, 'asset://clip.mp4', { startAt: 0, signal: new AbortController().signal })
  const rejected = assert.rejects(result, /decodieren.*Medienfehler 3/)
  video.error = { code: 3, message: 'decoder failed' }
  video.dispatchEvent(new Event('error'))
  await rejected
})

test('closing or replacing a loading clip removes old seek callbacks', async () => {
  const video = new Video()
  const controller = new AbortController()
  const old = loadVideoFrame(video.element, 'asset://old.mp4', { startAt: 50, signal: controller.signal })
  const rejected = assert.rejects(old, { name: 'AbortError' })
  controller.abort()
  await rejected
  const next = loadVideoFrame(video.element, 'asset://new.mp4', { startAt: 2, signal: new AbortController().signal })
  video.metadata(5)
  video.frame()
  assert.equal(await next, 5)
  assert.equal(video.currentTime, 2)
  assert.equal(video.src, 'asset://new.mp4')
})

test('missing frame events time out instead of leaving setup hanging', async () => {
  const video = new Video()
  const result = loadVideoFrame(video.element, 'asset://clip.mp4', { startAt: 0, signal: new AbortController().signal, timeoutMs: 5 })
  video.metadata()
  await assert.rejects(result, /kein Videobild geladen/)
  video.currentTime = 8
  video.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(video.currentTime, 8, 'timed-out requests must not seek a later clip')
})

test('invalid durations cannot unlock the timeline', async () => {
  const video = new Video()
  const result = loadVideoFrame(video.element, 'asset://clip.mp4', { startAt: 0, signal: new AbortController().signal })
  const rejected = assert.rejects(result, /Länge der Aufnahme/)
  video.metadata(Number.POSITIVE_INFINITY)
  await rejected
})

test('known source duration is used when the container cannot provide one', async () => {
  const video = new Video()
  const result = loadVideoFrame(video.element, 'asset://clip.mkv', { duration: 20, startAt: -3, signal: new AbortController().signal })
  video.metadata(Number.NaN)
  video.frame()
  assert.equal(await result, 20)
  assert.equal(video.currentTime, 17)
})

test('media access errors remain distinct from decoder errors', () => {
  assert.match(videoErrorText({ code: 2, message: '' }), /gelesen/)
  assert.match(videoErrorText({ code: 4, message: '' }), /nicht erreichbar.*nicht unterstützt/)
})
