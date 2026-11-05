import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, notFound, unauthorized } from '@/lib/api-response'
import { readKummerkastenImage } from '@/lib/kummerkasten/kummerkasten-images'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('kummerkasten:view')
  } catch (cause) {
    return cause instanceof Error && cause.message === 'Unauthorized' ? unauthorized() : error('Keine Berechtigung', 403)
  }
  const id = Number.parseInt((await params).id, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound('Bild')

  const entry = await prisma.kummerkastenEntry.findUnique({ where: { id }, select: { imageFilename: true, imageMimeType: true } })
  if (!entry?.imageFilename) return notFound('Bild')
  try {
    const data = await readKummerkastenImage(entry.imageFilename)
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': entry.imageMimeType ?? 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return notFound('Bild')
  }
}
