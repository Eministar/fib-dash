import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAuth, requirePermission } from '@/lib/auth'
import { error, success, unauthorized } from '@/lib/api-response'
import { hasPermission } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit/audit'
import {
  MAX_IMAGE_BYTES,
  detectKummerkastenImage,
  isKummerkastenStatus,
  kummerkastenNumber,
  parseKummerkastenInput,
} from '@/lib/kummerkasten/kummerkasten'
import { storeKummerkastenImage } from '@/lib/kummerkasten/kummerkasten-images'
import { queueKummerkastenTask, syncKummerkastenPost } from '@/lib/kummerkasten/kummerkasten-forum'

export const dynamic = 'force-dynamic'

/**
 * Neue Einsendung vom PD-Bot (multipart/form-data). Nur per API-Token mit Scope
 * `kummerkasten:submit` und ohne `X-Discord-Id` – sonst würde der Aufruf einem
 * Nutzer zugeordnet. Bei anonymen Einsendungen werden Absenderfelder verworfen.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentAuth(false)
  if (!auth) return unauthorized()
  if (auth.kind !== 'api' || auth.impersonation) return error('Nur per API-Token ohne X-Discord-Id erlaubt', 403)
  if (!hasPermission(auth.user, 'kummerkasten:submit')) return error('Keine Berechtigung', 403)

  const form = await req.formData().catch(() => null)
  if (!form) return error('Erwartet multipart/form-data')

  let input
  try {
    input = parseKummerkastenInput(Object.fromEntries(
      ['subject', 'message', 'anonymous', 'authorName', 'authorDiscordId', 'authorAvatarUrl'].map((key) => [key, form.get(key)]),
    ))
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Ungültige Einsendung')
  }

  let image: { filename: string; mimeType: string } | null = null
  const attachment = form.get('attachment')
  if (attachment instanceof File && attachment.size > 0) {
    if (attachment.size > MAX_IMAGE_BYTES) return error('Bild ist zu groß', 413)
    const bytes = Buffer.from(await attachment.arrayBuffer())
    const type = detectKummerkastenImage(bytes)
    if (!type) return error('Als Anhang sind nur JPG- oder PNG-Bilder erlaubt', 415)
    image = { filename: await storeKummerkastenImage(bytes, type.extension), mimeType: type.mimeType }
  }

  const entry = await prisma.kummerkastenEntry.create({
    data: { ...input, imageFilename: image?.filename ?? null, imageMimeType: image?.mimeType ?? null },
    select: { id: true },
  })
  const number = kummerkastenNumber(entry.id)

  // Bewusst ohne Betreff, Text oder Absender: Das Protokoll lesen mehr Leute als FIB-01.
  await createAuditLog({ action: 'KUMMERKASTEN_RECEIVED', userId: null, details: `${number} eingegangen`, auth })

  // Forum im Hintergrund – die Einsendung ist gespeichert, auch wenn Discord hakt.
  queueKummerkastenTask(`Beitrag für ${number}`, () => syncKummerkastenPost(entry.id))

  return success({ id: entry.id, number }, 201)
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('kummerkasten:view')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : ''
    if (message === 'Unauthorized') return unauthorized()
    return error('Keine Berechtigung', 403)
  }

  const status = new URL(req.url).searchParams.get('status')
  const rows = await prisma.kummerkastenEntry.findMany({
    where: isKummerkastenStatus(status) ? { status } : undefined,
    orderBy: { id: 'desc' },
    take: 500,
    select: {
      id: true, subject: true, anonymous: true, authorName: true, status: true,
      imageFilename: true, discordThreadId: true, createdAt: true, updatedAt: true,
    },
  })
  return success(rows.map(({ imageFilename, ...row }) => ({ ...row, number: kummerkastenNumber(row.id), hasImage: Boolean(imageFilename) })))
}
