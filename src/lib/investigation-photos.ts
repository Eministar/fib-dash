import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@/generated/prisma'
import { prisma } from './prisma'
import { uploadDir } from './uploads'
import { withoutChangeTracking } from './change-history-context'
import { deleteDiscordHrEventMessage, getDiscordConfig, getDiscordLatestMessageId, getDiscordPhotoMessages, postDiscordChannelMessage, type DiscordPhotoMessage } from './discord-integration'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export function photoPath(filename: string) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/.test(filename)) throw new Error('Ungültige Bilddatei')
  return path.join(/*turbopackIgnore: true*/ uploadDir(), 'investigation-photos', filename)
}

export function isDiscordImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) && url.pathname.startsWith('/attachments/') }
  catch { return false }
}

export function detectPhotoType(bytes: Uint8Array) {
  const b = Buffer.from(bytes)
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mimeType: 'image/png' }
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { extension: 'jpg', mimeType: 'image/jpeg' }
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())) return { extension: 'gif', mimeType: 'image/gif' }
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { extension: 'webp', mimeType: 'image/webp' }
  return null
}

async function importMessage(channelId: string, message: DiscordPhotoMessage) {
  let imported = 0
  for (const attachment of message.attachments ?? []) {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(attachment.filename) || !isDiscordImageUrl(attachment.url)) continue
    if (attachment.size && attachment.size > MAX_IMAGE_BYTES) continue
    const sourceKey = `${channelId}:${message.id}:${attachment.id}`
    if (await prisma.investigationPhoto.findUnique({ where: { sourceKey }, select: { id: true } })) continue
    const response = await fetch(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!response.ok || !response.body) throw new Error(`Discord-Bildabruf fehlgeschlagen (${response.status})`)
    const reader = response.body.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_IMAGE_BYTES) { await reader.cancel(); break }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    if (size > MAX_IMAGE_BYTES) continue
    const bytes = Buffer.concat(chunks)
    const type = detectPhotoType(bytes)
    if (!type) continue
    const filename = `${randomUUID()}.${type.extension}`
    await mkdir(path.dirname(photoPath(filename)), { recursive: true })
    await writeFile(photoPath(filename), bytes, { flag: 'wx' })
    try {
      await prisma.investigationPhoto.create({ data: {
        sourceKey, channelId, messageId: message.id, filename, mimeType: type.mimeType, sizeBytes: size,
        title: (message.content?.trim() || attachment.filename).slice(0, 200),
      } })
      imported++
    } catch (cause) {
      // Ingestion is idempotent across server instances.
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') await unlink(photoPath(filename))
      else throw cause // An uncertain DB commit must not remove a possibly referenced image.
    }
  }
  return imported
}

/**
 * Hinweistext, der im Bilder-Channel immer als letzte Nachricht stehen soll.
 * Die Basis-URL kommt aus `NEXT_PUBLIC_SITE_URL`; im Hintergrundlauf gibt es
 * keinen Request, aus dem sie sich sonst ableiten ließe.
 */
const PHOTO_CATALOG_URL = `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://nerovfib.de').replace(/\/$/, '')}/investigations/photos`
const STICKY_TEXT = [
  '📸 **Bildkatalog**',
  'Jede Nachricht in diesem Channel wird automatisch als Bild in den Bildkatalog hochgeladen.',
  `Alle Bilder findest du unter ${PHOTO_CATALOG_URL}`,
].join('\n')

/**
 * Hält den Hinweis als letzte Nachricht im Channel. Steht er bereits unten,
 * passiert nichts – sonst wird die alte Nachricht gelöscht und neu gepostet.
 * Fehler bleiben folgenlos: der Bildimport ist wichtiger als der Hinweis.
 */
async function ensureStickyNotice(channel: string) {
  const key = `discord.photoCatalogSticky.${channel}`
  try {
    const stored = await prisma.systemSetting.findUnique({ where: { key } })
    const newest = await getDiscordLatestMessageId(channel)
    if (stored?.value && stored.value === newest) return
    if (stored?.value) await deleteDiscordHrEventMessage(channel, stored.value)
    const message = await postDiscordChannelMessage(channel, STICKY_TEXT)
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: message.id }, update: { value: message.id } })
  } catch (cause) {
    console.error('[PhotoCatalog] Sticky-Hinweis konnte nicht aktualisiert werden:', cause)
  }
}

type SyncState = { latest: string; before?: string; newest?: string; backfillBefore?: string; backfillDone?: boolean }
const runtime = globalThis as typeof globalThis & { photoSync?: Promise<{ imported: number; configured: boolean }>; photoSyncTimer?: ReturnType<typeof setInterval> }

async function runPhotoSync() {
  const config = await getDiscordConfig()
  if (!config.photoCatalogChannelId) return { imported: 0, configured: false }
  const channel = config.photoCatalogChannelId
  const key = `discord.photoCatalogState.${channel}`
  const setting = await prisma.systemSetting.findUnique({ where: { key } })
  const state: SyncState = setting ? JSON.parse(setting.value) : { latest: '0' }
  const page = await getDiscordPhotoMessages(channel, state.before)
  let imported = 0
  for (const message of page) if (BigInt(message.id) > BigInt(state.latest)) imported += await importMessage(channel, message)
  const sorted = page.map(m => m.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
  const oldest = sorted[0]
  const newest = sorted.at(-1)
  if (state.latest === '0') {
    state.latest = newest ?? '0'
    state.backfillBefore = oldest
    state.backfillDone = page.length < 100
  } else if (page.length === 100 && oldest && BigInt(oldest) > BigInt(state.latest)) {
    state.newest ??= newest
    state.before = oldest
  } else {
    const candidate = state.newest ?? newest ?? state.latest
    if (BigInt(candidate) > BigInt(state.latest)) state.latest = candidate
    state.before = undefined
    state.newest = undefined
  }
  // Walk older history separately, without delaying discovery of new uploads.
  if (!state.backfillDone && state.backfillBefore && setting) {
    const older = await getDiscordPhotoMessages(channel, state.backfillBefore)
    for (const message of older) imported += await importMessage(channel, message)
    state.backfillBefore = older.map(m => m.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)[0] ?? state.backfillBefore
    state.backfillDone = older.length < 100
  }
  const value = JSON.stringify(state)
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  // Zum Schluss, damit der Hinweis nicht zwischen den gerade importierten Bildern landet.
  await ensureStickyNotice(channel)
  return { imported, configured: true }
}

export function syncInvestigationPhotos() {
  if (!runtime.photoSync) runtime.photoSync = withoutChangeTracking(runPhotoSync).finally(() => { runtime.photoSync = undefined })
  return runtime.photoSync
}

export function ensurePhotoCatalogSync() {
  if (runtime.photoSyncTimer || process.env.PHOTO_CATALOG_SYNC_ENABLED === 'false') return
  const sync = () => { void syncInvestigationPhotos().catch(cause => console.error('[PhotoCatalog]', cause)) }
  runtime.photoSyncTimer = setInterval(sync, 60_000)
  runtime.photoSyncTimer.unref?.()
  sync()
}

export async function investigationPhotoResponse(filename: string, mimeType: string) {
  const bytes = await readFile(photoPath(filename))
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } })
}
