import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { getUserByDiscordId } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit/audit'
import { clipExtensionFor, clipMaxBytes, resolveClipPath } from '@/lib/media/clips'
import { discordFetch } from '@/lib/discord/discord-integration'
import { MAX_IMAGE_BYTES, detectPhotoType, isDiscordImageUrl, photoPath } from '@/lib/investigations/investigation-photos'
import { hasPermission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/core/prisma-errors'

/**
 * Antworten in einem Akten-Beitrag des Ermittlungs-Forums werden Teil der
 * Akte: Text als Chronologie-Eintrag, Bilder in den Bildkatalog der Akte,
 * Videos als Bodycam-Clips. Übernommen wird nur von Discord-Konten, die im
 * Dashboard Akten bearbeiten dürfen; die Nachricht bekommt ✅ bzw. ⛔.
 *
 * Ist die KI an, wird reiner Text nicht direkt übernommen: Der Bot antwortet
 * mit einem ausformulierten Vorschlag, den der Verfasser übernimmt oder
 * verwirft (siehe `ai-discord.ts`). Nachrichten mit Anhängen gehen weiter direkt.
 */

type Attachment = { id: string; filename: string; url: string; size?: number; content_type?: string }
export type ForumThreadMessage = {
  id: string
  channel_id: string
  content?: string
  timestamp?: string
  webhook_id?: string
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean }
  member?: { nick?: string | null }
  attachments?: Attachment[]
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i
const VIDEO_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska' }

function videoMimeType(attachment: Attachment) {
  const declared = attachment.content_type?.split(';')[0]?.trim().toLowerCase()
  if (declared && clipExtensionFor(declared)) return declared
  return VIDEO_TYPES[path.extname(attachment.filename).toLowerCase()] ?? null
}

async function react(channelId: string, messageId: string, emoji: string) {
  await discordFetch(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT' })
    .catch((error) => console.warn('[ForumInbound] Reaktion fehlgeschlagen (Bot braucht „Reaktionen hinzufügen“):', error))
}

async function downloadImage(attachment: Attachment) {
  if (!isDiscordImageUrl(attachment.url) || (attachment.size && attachment.size > MAX_IMAGE_BYTES)) return null
  const response = await fetch(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Bildabruf fehlgeschlagen (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) return null
  const type = detectPhotoType(bytes)
  return type ? { bytes, type } : null
}

async function importImage(investigationId: string, message: ForumThreadMessage, attachment: Attachment, uploadedById: string, title: string) {
  const sourceKey = `${message.channel_id}:${message.id}:${attachment.id}`
  if (await prisma.investigationPhoto.findUnique({ where: { sourceKey }, select: { id: true } })) return false
  const image = await downloadImage(attachment)
  if (!image) return false
  const filename = `${randomUUID()}.${image.type.extension}`
  await mkdir(path.dirname(photoPath(filename)), { recursive: true })
  await writeFile(photoPath(filename), image.bytes, { flag: 'wx' })
  try {
    await prisma.investigationPhoto.create({
      data: {
        sourceKey, channelId: message.channel_id, messageId: message.id, filename, mimeType: image.type.mimeType,
        sizeBytes: image.bytes.length, title: title.slice(0, 200), uploadedById,
        investigations: { connect: { id: investigationId } },
      },
    })
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) { await unlink(photoPath(filename)).catch(() => undefined); return false }
    throw error
  }
}

async function importVideo(investigationId: string, entryId: string, attachment: Attachment, mimeType: string, uploadedById: string, title: string) {
  if (!isDiscordImageUrl(attachment.url)) return false
  if (attachment.size && attachment.size > clipMaxBytes()) return false
  const extension = clipExtensionFor(mimeType)
  if (!extension) return false
  const filename = `${randomUUID()}${extension}`
  const target = resolveClipPath(filename)
  await mkdir(path.dirname(target), { recursive: true })
  const response = await fetch(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(10 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`Videoabruf fehlgeschlagen (${response.status})`)
  let size = 0
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), async function* (source) {
      for await (const chunk of source) {
        size += (chunk as Buffer).length
        if (size > clipMaxBytes()) throw new Error('Video zu groß')
        yield chunk
      }
    }, createWriteStream(target, { flags: 'wx' }))
    await prisma.bodycamClip.create({
      data: {
        investigationId, entryId, title: title.slice(0, 200), filename,
        originalName: attachment.filename.slice(0, 255), sizeBytes: BigInt(size), mimeType, uploadedById,
      },
    })
    return true
  } catch (error) {
    await unlink(target).catch(() => undefined)
    throw error
  }
}

function authorName(message: ForumThreadMessage) {
  return message.member?.nick || message.author?.global_name || message.author?.username || 'Discord'
}

export async function importForumThreadMessage(message: ForumThreadMessage) {
  if (message.webhook_id || message.author?.bot) return
  const investigation = await prisma.investigation.findFirst({
    where: { discordThreadId: message.channel_id },
    select: { id: true, caseNumber: true },
  })
  if (!investigation) return

  const text = message.content?.trim() ?? ''
  const attachments = message.attachments ?? []
  if (!text && attachments.length === 0) return
  if (await prisma.investigationEntry.findUnique({ where: { discordMessageId: message.id }, select: { id: true } })) return

  const user = message.author?.id ? await getUserByDiscordId(message.author.id) : null
  if (!user || !hasPermission(user, 'investigations:manage')) {
    await react(message.channel_id, message.id, '⛔')
    return
  }

  const name = authorName(message)
  if (text && attachments.length === 0) {
    const { proposeThreadEntry } = await import('@/lib/ai/ai-discord')
    const proposed = await proposeThreadEntry({
      id: message.id,
      channelId: message.channel_id,
      text,
      authorDiscordId: message.author!.id!,
      authorName: name,
      timestamp: new Date(message.timestamp ?? Date.now()),
    }, investigation.id, user)
    if (proposed) return
  }

  let entryId: string
  try {
    const entry = await prisma.investigationEntry.create({
      data: {
        investigationId: investigation.id,
        kind: 'NOTE',
        title: `Discord · ${name}`.slice(0, 200),
        content: text || null,
        occurredAt: new Date(message.timestamp ?? Date.now()),
        participants: [],
        createdById: user.id,
        discordMessageId: message.id,
      },
      select: { id: true },
    })
    entryId = entry.id
  } catch (error) {
    if (isUniqueConstraintError(error)) return // gleichzeitig schon übernommen
    throw error
  }

  let images = 0
  let videos = 0
  const failed: string[] = []
  for (const attachment of attachments) {
    const title = text ? `${text.slice(0, 120)} (${attachment.filename})` : attachment.filename
    try {
      if (IMAGE_FILE.test(attachment.filename)) {
        if (await importImage(investigation.id, message, attachment, user.id, title)) images++
      } else {
        const mimeType = videoMimeType(attachment)
        if (mimeType && await importVideo(investigation.id, entryId, attachment, mimeType, user.id, title)) videos++
        else if (!mimeType) failed.push(attachment.filename)
      }
    } catch (error) {
      console.error(`[ForumInbound] Anhang ${attachment.filename} nicht übernommen:`, error)
      failed.push(attachment.filename)
    }
  }

  await prisma.investigation.update({ where: { id: investigation.id }, data: { updatedAt: new Date() }, select: { id: true } })
  await createAuditLog({
    action: 'INVESTIGATION_ENTRY_CREATED',
    userId: user.id,
    details: `Akte ${investigation.caseNumber}: Antwort aus Discord übernommen${images ? ` · ${images} Bilder` : ''}${videos ? ` · ${videos} Videos` : ''}`,
  })
  await react(message.channel_id, message.id, failed.length ? '⚠️' : '✅')
}

/**
 * Eine bereits übernommene Antwort wurde in Discord bearbeitet: den Text des
 * Chronologie-Eintrags nachziehen. Anhänge lassen sich in Discord nachträglich
 * nicht hinzufügen, deshalb geht es hier nur um den Text.
 */
export async function updateForumThreadMessage(message: ForumThreadMessage) {
  // Ohne `content` ist es nur ein nachgeladenes Link-Vorschaubild, keine Bearbeitung.
  if (message.content === undefined || message.webhook_id || message.author?.bot) return

  // Gehört die Nachricht zu einem KI-Vorschlag, wird dieser neu formuliert –
  // ein übernommener Eintrag wird nicht mit dem Rohtext überschrieben.
  if (message.author?.id && message.content.trim()) {
    const { refreshThreadProposal } = await import('@/lib/ai/ai-discord')
    const handled = await refreshThreadProposal({
      id: message.id,
      channelId: message.channel_id,
      text: message.content.trim(),
      authorDiscordId: message.author.id,
      authorName: authorName(message),
      timestamp: new Date(message.timestamp ?? Date.now()),
    })
    if (handled) return
  }

  const entry = await prisma.investigationEntry.findUnique({
    where: { discordMessageId: message.id },
    select: { id: true, content: true, investigation: { select: { id: true, caseNumber: true, discordThreadId: true } } },
  })
  if (!entry || entry.investigation.discordThreadId !== message.channel_id) return
  const text = message.content.trim() || null
  if (text === entry.content) return

  const user = message.author?.id ? await getUserByDiscordId(message.author.id) : null
  if (!user || !hasPermission(user, 'investigations:manage')) return

  await prisma.investigationEntry.update({ where: { id: entry.id }, data: { content: text }, select: { id: true } })
  await prisma.investigation.update({ where: { id: entry.investigation.id }, data: { updatedAt: new Date() }, select: { id: true } })
  await createAuditLog({
    action: 'INVESTIGATION_ENTRY_UPDATED',
    userId: user.id,
    details: `Akte ${entry.investigation.caseNumber}: Antwort in Discord bearbeitet und übernommen`,
  })
  await react(message.channel_id, message.id, '✏️')
}
