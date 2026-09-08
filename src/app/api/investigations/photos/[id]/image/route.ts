import { requirePermission } from '@/lib/auth'
import { notFound } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { routeError } from '@/lib/investigations-server'
import { investigationPhotoResponse } from '@/lib/investigation-photos'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission('investigations:view')
    const photo = await prisma.investigationPhoto.findUnique({ where: { id: (await params).id } })
    if (!photo) return notFound('Bild')
    return await investigationPhotoResponse(photo.filename, photo.mimeType)
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return notFound('Bilddatei'); return routeError(cause) }
}
