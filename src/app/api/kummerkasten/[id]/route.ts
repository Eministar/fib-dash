import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthContext } from '@/lib/auth'
import { error, notFound, success, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit/audit'
import { getDiscordConfig } from '@/lib/discord/discord-integration'
import { KUMMERKASTEN_STATUS_LABELS, isKummerkastenStatus, kummerkastenNumber } from '@/lib/kummerkasten/kummerkasten'
import { queueKummerkastenTask, syncKummerkastenPost } from '@/lib/kummerkasten/kummerkasten-forum'
import type { Permission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

function parseId(raw: string) {
  const id = Number.parseInt(raw, 10)
  return Number.isSafeInteger(id) && id > 0 && String(id) === raw ? id : null
}

async function authorize(permission: Permission) {
  try {
    return { auth: await requireAuthContext(permission) }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    return { response: message === 'Unauthorized' ? unauthorized() : error('Keine Berechtigung', 403) }
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await authorize('kummerkasten:view')
  if (response) return response
  const id = parseId((await params).id)
  if (!id) return notFound('Einsendung')

  const entry = await prisma.kummerkastenEntry.findUnique({ where: { id } })
  if (!entry) return notFound('Einsendung')
  const { guildId } = await getDiscordConfig()
  return success({
    id: entry.id,
    subject: entry.subject,
    message: entry.message,
    anonymous: entry.anonymous,
    authorName: entry.authorName,
    authorDiscordId: entry.authorDiscordId,
    authorAvatarUrl: entry.authorAvatarUrl,
    status: entry.status,
    discordThreadId: entry.discordThreadId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    number: kummerkastenNumber(entry.id),
    imageUrl: entry.imageFilename ? `/api/kummerkasten/${entry.id}/image` : null,
    threadUrl: entry.discordThreadId && guildId ? `https://discord.com/channels/${guildId}/${entry.discordThreadId}` : null,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await authorize('kummerkasten:manage')
  if (response) return response
  const id = parseId((await params).id)
  if (!id) return notFound('Einsendung')

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!isKummerkastenStatus(body.status)) return error('Ungültiger Status')

  const existing = await prisma.kummerkastenEntry.findUnique({ where: { id }, select: { status: true } })
  if (!existing) return notFound('Einsendung')
  if (existing.status === body.status) return success({ id, status: existing.status })

  const updated = await prisma.kummerkastenEntry.update({ where: { id }, data: { status: body.status }, select: { id: true, status: true } })
  await createAuditLog({
    action: 'KUMMERKASTEN_STATUS',
    userId: auth!.user.id,
    oldValue: KUMMERKASTEN_STATUS_LABELS[existing.status],
    newValue: KUMMERKASTEN_STATUS_LABELS[updated.status],
    details: kummerkastenNumber(id),
    auth: auth!,
  })
  queueKummerkastenTask(`Status ${kummerkastenNumber(id)}`, () => syncKummerkastenPost(id))
  return success(updated)
}
