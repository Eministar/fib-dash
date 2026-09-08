import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { prisma } from './prisma'
import { resolveClipPath } from './clips'
import { checkMediaTools, transcodeClip } from './clip-transcode'
import { createAuditLog } from './audit'
import { withoutChangeTracking } from './change-history-context'

const runtime = globalThis as typeof globalThis & { clipCompressionRunning?: boolean; clipCompressionTimer?: ReturnType<typeof setInterval> }
const staleAfterMs = 5 * 60_000

async function removeFile(filename: string) {
  try { await unlink(resolveClipPath(filename)) }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause }
}

async function cleanOriginals() {
  const clips = await prisma.bodycamClip.findMany({ where: { compressionStatus: 'COMPRESSED', compressionSource: { not: null } }, take: 20 })
  for (const clip of clips) {
    if (!clip.compressionSource || clip.compressionSource === clip.filename) continue
    await removeFile(clip.compressionSource)
    await prisma.bodycamClip.updateMany({ where: { id: clip.id, compressionSource: clip.compressionSource }, data: { compressionSource: null } })
  }
}

/** Claim through a DB compare-and-swap, so two server instances cannot own a clip. */
export async function compressNextClip() {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const eligible = { OR: [{ compressionStatus: 'PENDING' }, { compressionStatus: 'PROCESSING', compressionStartedAt: { lt: cutoff } }] }
  const clip = await prisma.bodycamClip.findFirst({ where: eligible, orderBy: { createdAt: 'asc' } })
  if (!clip) return false
  const output = `${randomUUID()}.webm`
  const claimed = await prisma.bodycamClip.updateMany({
    where: { id: clip.id, filename: clip.filename, ...eligible },
    data: { compressionStatus: 'PROCESSING', compressionOutput: output, compressionStartedAt: new Date(), compressionError: null },
  })
  if (!claimed.count) return true
  const owned = { id: clip.id, compressionStatus: 'PROCESSING', compressionOutput: output, filename: clip.filename }
  const heartbeat = setInterval(() => {
    void prisma.bodycamClip.updateMany({ where: owned, data: { compressionStartedAt: new Date() } }).catch(cause => console.error('[ClipCompression] Heartbeat:', cause))
  }, 30_000)
  heartbeat.unref?.()
  try {
    if (clip.compressionOutput && clip.compressionOutput !== clip.filename) await removeFile(clip.compressionOutput)
    const result = await transcodeClip(resolveClipPath(clip.filename), resolveClipPath(output))
    if (result.skipped) {
      await prisma.bodycamClip.updateMany({ where: owned, data: { compressionStatus: 'SKIPPED', compressionOutput: null, compressionError: result.reason } })
    } else {
      const changed = await prisma.$transaction(async tx => {
        const update = await tx.bodycamClip.updateMany({ where: owned, data: {
          filename: output, mimeType: 'video/webm', sizeBytes: BigInt(result.sizeBytes),
          originalSizeBytes: clip.originalSizeBytes ?? BigInt(result.originalSizeBytes),
          durationSeconds: result.durationSeconds, compressionStatus: 'COMPRESSED',
          compressionSource: clip.filename, compressionOutput: null, compressedAt: new Date(), compressionError: null,
        } })
        if (update.count) await createAuditLog({ action: 'CLIP_COMPRESSED', userId: null, details: `Automatische Komprimierung: ${clip.id}; ${result.originalSizeBytes} → ${result.sizeBytes} Bytes` }, tx)
        return update.count
      })
      if (!changed) {
        // The clip was removed or another worker recovered an expired lease.
        const current = await prisma.bodycamClip.findUnique({ where: { id: clip.id }, select: { filename: true } })
        if (current?.filename !== output) await removeFile(output)
      }
    }
  } catch (cause) {
    console.error('[ClipCompression]', clip.id, cause)
    // A commit can succeed even if its acknowledgement is lost. Never remove
    // the candidate unless the database confirms it still belongs to this job.
    const failed = await prisma.bodycamClip.updateMany({ where: owned, data: {
      compressionStatus: 'FAILED', compressionError: 'Komprimierung fehlgeschlagen. Original bleibt erhalten.',
    } })
    if (failed.count) {
      await removeFile(output)
      await prisma.bodycamClip.updateMany({ where: { id: clip.id, compressionOutput: output }, data: { compressionOutput: null } })
    }
  } finally { clearInterval(heartbeat) }
  return true
}

export async function drainClipCompressionQueue() {
  if (runtime.clipCompressionRunning || process.env.CLIP_COMPRESSION_ENABLED === 'false') return
  runtime.clipCompressionRunning = true
  try {
    await cleanOriginals()
    await checkMediaTools()
    // One encode per process; never block an upload request while encoding.
    while (await compressNextClip()) await cleanOriginals()
  } finally { runtime.clipCompressionRunning = false }
}

export function queueClipCompression() {
  void withoutChangeTracking(drainClipCompressionQueue).catch(cause => console.error('[ClipCompression] Queue:', cause))
}

export function ensureClipCompressionWorker() {
  if (runtime.clipCompressionTimer || process.env.CLIP_COMPRESSION_ENABLED === 'false') return
  runtime.clipCompressionTimer = setInterval(queueClipCompression, 60_000)
  runtime.clipCompressionTimer.unref?.()
  queueClipCompression()
}
