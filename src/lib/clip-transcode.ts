import { spawn } from 'node:child_process'
import { stat, unlink } from 'node:fs/promises'

export type CompressionOptions = {
  codec: 'av1' | 'vp9'
  crf: number
  maxWidth: number
  maxHeight: number
  threads: number
  timeoutMs: number
}

function integerEnv(key: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[key])
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export function compressionOptions(): CompressionOptions {
  return {
    codec: process.env.CLIP_VIDEO_CODEC === 'vp9' ? 'vp9' : 'av1',
    crf: integerEnv('CLIP_VIDEO_CRF', 36, 20, 50),
    maxWidth: integerEnv('CLIP_VIDEO_MAX_WIDTH', 1280, 320, 3840),
    maxHeight: integerEnv('CLIP_VIDEO_MAX_HEIGHT', 720, 240, 2160),
    threads: integerEnv('CLIP_VIDEO_THREADS', 2, 1, 8),
    timeoutMs: integerEnv('CLIP_TRANSCODE_TIMEOUT_MS', 7_200_000, 10_000, 14_400_000),
  }
}

/** Argument arrays, no shell; bounded output, CPU and wall time. */
export function runMediaTool(executable: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let failure: Error | null = null
    const timeout = setTimeout(() => {
      failure = new Error('Zeitlimit für Videokomprimierung überschritten')
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 1024 * 1024) { failure = new Error('Ungültige Video-Metadaten'); child.kill('SIGKILL') }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8000) })
    child.on('error', cause => { failure = cause })
    child.on('close', code => {
      clearTimeout(timeout)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Videokonvertierung fehlgeschlagen: ${stderr.slice(-500)}`))
      else resolve(stdout)
    })
  })
}

type Probe = {
  format?: { duration?: string }
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; avg_frame_rate?: string; disposition?: { attached_pic?: number }; color_transfer?: string }[]
}

export async function probeClip(file: string) {
  const result = await runMediaTool(process.env.FFPROBE_PATH?.trim() || 'ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-show_format', '-show_streams', '-of', 'json', file,
  ], 30_000)
  const info = JSON.parse(result) as Probe
  const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic)
  const duration = Number(info.format?.duration || video?.duration)
  if (!video || !video.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error('Keine vollständige Videoaufnahme gefunden')
  return { video, duration, audioCount: info.streams?.filter(stream => stream.codec_type === 'audio').length ?? 0 }
}

export function transcodeArgs(input: string, output: string, options: CompressionOptions) {
  const filter = `scale=w='min(iw,${options.maxWidth})':h='min(ih,${options.maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-xerror',
    '-threads', String(options.threads), '-filter_threads', '1',
    '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-i', input,
    '-map', '0:V:0', '-map', '0:a?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', filter, '-fpsmax', '30', '-pix_fmt', 'yuv420p',
    ...(options.codec === 'av1'
      ? ['-c:v', 'libsvtav1', '-preset', '6', '-crf', String(options.crf), '-svtav1-params', `lp=${options.threads}`]
      : ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '2', '-crf', String(options.crf), '-b:v', '0', '-row-mt', '1']),
    '-threads', String(options.threads), '-g', '240',
    '-c:a', 'libopus', '-b:a', '64k', '-ac', '2', '-vbr', 'on',
    '-f', 'webm', output,
  ]
}

export function validCompressedDuration(source: number, output: number) {
  return Math.abs(source - output) <= Math.max(0.25, Math.min(1, source * 0.005))
}

const ENCODER_NAME: Record<CompressionOptions['codec'], string> = {
  av1: 'libsvtav1',
  vp9: 'libvpx-vp9',
}

/**
 * Wählt den Encoder aus dem, was ffmpeg tatsächlich mitbringt.
 *
 * Fehlt der gewünschte, wird auf den anderen ausgewichen statt aufzugeben: ein
 * schwächerer Encoder ist besser als gar keine Komprimierung. Genau daran hing
 * es — `libsvtav1` ist in älteren Debian- und Ubuntu-Paketen nicht enthalten,
 * und der Abbruch war lautlos.
 */
export function pickCodec(encoderListing: string, configured: CompressionOptions['codec']) {
  if (!encoderListing.trim()) {
    throw new Error('ffmpeg liefert keine Encoder-Liste — ist ffmpeg installiert?')
  }
  if (!encoderListing.includes('libopus')) {
    throw new Error('ffmpeg benötigt libopus für die Tonspur; das Paket bringt es nicht mit')
  }

  const wanted = ENCODER_NAME[configured]
  if (encoderListing.includes(wanted)) return { codec: configured, fallback: null as string | null }

  const other: CompressionOptions['codec'] = configured === 'av1' ? 'vp9' : 'av1'
  if (encoderListing.includes(ENCODER_NAME[other])) {
    return {
      codec: other,
      fallback: `${wanted} fehlt, es wird ${ENCODER_NAME[other]} verwendet`,
    }
  }

  throw new Error(`ffmpeg bringt weder ${ENCODER_NAME.av1} noch ${ENCODER_NAME.vp9} mit`)
}

/**
 * Prüft die Werkzeuge und liefert den nutzbaren Codec. Wirft mit einer
 * Meldung, die benennt, was fehlt — sie landet am Clip, nicht nur im Log.
 */
export async function checkMediaTools() {
  const encoders = await runMediaTool(
    process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
    ['-hide_banner', '-encoders'],
    15_000,
  ).catch(() => '')

  const picked = pickCodec(encoders, compressionOptions().codec)
  await runMediaTool(process.env.FFPROBE_PATH?.trim() || 'ffprobe', ['-version'], 15_000)
  return picked
}

/** Produces a verified candidate only. The caller owns the DB switch and source deletion. */
export async function transcodeClip(input: string, output: string, options = compressionOptions()) {
  try {
    const source = await probeClip(input)
    // Avoid silently washing out HDR footage; keep it intact for a separate HDR workflow.
    if (['smpte2084', 'arib-std-b67'].includes(source.video.color_transfer ?? '')) return { skipped: true as const, reason: 'HDR-Aufnahme bleibt unverändert' }
    const original = await stat(input)
    await runMediaTool(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', transcodeArgs(input, output, options), options.timeoutMs)
    const result = await probeClip(output)
    if (!validCompressedDuration(source.duration, result.duration) || result.audioCount !== source.audioCount) throw new Error('Komprimiertes Video ist unvollständig')
    if (result.video.codec_name !== (options.codec === 'av1' ? 'av1' : 'vp9')) throw new Error('Unerwarteter Videocodec')
    // Probe metadata alone does not prove the media packets decode successfully.
    await runMediaTool(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-threads', String(options.threads),
      '-protocol_whitelist', 'file,pipe', '-i', output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-',
    ], options.timeoutMs)
    const compressed = await stat(output)
    if (compressed.size >= original.size || compressed.size === 0) {
      await unlink(output)
      return { skipped: true as const, reason: 'Original ist bereits kleiner' }
    }
    return { skipped: false as const, sizeBytes: compressed.size, originalSizeBytes: original.size, durationSeconds: Math.round(result.duration) }
  } catch (cause) {
    await unlink(output).catch(() => {})
    throw cause
  }
}
